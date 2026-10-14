/**
 * dsh-hs2-pipeline — client half.
 *
 * Sidebar entry sits next to 技能中心. The page is a preparation-style flow chart:
 *   素材 -> 拆分 -> (每个部件各走一条线) 拆分.blend + 预览图 -> 贴合 -> 贴合.blend + 预览图 -> 做成 mod -> zipmod
 * Everything after step 1 is a Blender file. A preview image is mandatory at every stage.
 *
 * Prompts stay short. They keep the global rules and the file locations, then two lines:
 * hand the job to a Codex sub-agent, and pick the one that can write files.
 * Per-part rules stay on the page for the person reading them. They are not pasted into the prompt.
 */
window.__ModuleLoader__.load({
	id: "dsh-hs2-pipeline",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var name = "dsh-hs2-pipeline";
		var inject = [];
		var LS_KEY = "dsh-hs2-pipeline.v6";

		function R(t, d) { return { t: t, d: d }; }

		/* ---------- rules that apply to a whole step ---------- */
		var PREVIEW = [
			R("是什么图", "Blender 里渲染的多角度拼图：正面、侧面、背面、斜 45 度。每件一张，文件名用约定的路径。缺一张都不算完成。"),
			R("要有原贴图", "必须是带原贴图的材质预览。保留原 UV、材质槽和贴图节点，外部图片要打包进 .blend。只显示单色的 Solid 视图不算，那只会显示对象颜色。"),
			R("Blender 5 的坑", "当前引擎是 Workbench 时，直接把 3D 视图设成 MATERIAL 会报枚举不存在。先切到支持材质的引擎（例如 CYCLES），再设成材质预览，并关掉场景灯光和场景世界。"),
			R("别过曝", "小尺度模型不要照搬米级灯光功率，过曝会把贴图吞掉。"),
			R("出图", "渲染时就用材质预览并带上原贴图。出完这张图即可，不要再打开文件复查。")
		];
		var GLOBAL_SPLIT = [
			R("看情况拆", "按模型本身怎么分就怎么拆。本来是分开的才拆开。没有的部位留空，不要为了凑部位硬切。"),
			R("上衣下装", "衣身和裙摆连成一件的，整件放进上衣，不要在腰线撕开，也不要另做一件下装。只有模型里上衣和下装本来就是分开的两件，才放下装。"),
			R("丢掉", "脸、眼睛、表情、指甲直接丢，不交付。皮肤材质是裸体，不交付。"),
			R("反面层", "材质名带 + 的是翻面的背面层。HS2 衣服着色器是双面的，留着会碎斑，删掉。"),
			R("交付", "真有的部位各交一个 .blend 和一张预览图。空的部位不要做文件。"),
			R("饰品分开", "饰品按个体拆开，一个个体一个 .blend。同一个饰品的部件放在一起，不同个体不要并进一个文件。有几个个体，DSH 自己加几条分支，part 用 acc、acc2、acc3，name 写这个饰品的名字。不要开子代理来加分支，也不要等着去点「添加饰品」。"),
			R("贴图", "源文件的贴图全程保留。拆开时不要丢 UV、材质槽和贴图节点，外部图片打包进 .blend。不要换成单色。")
		];
		var GLOBAL_FIT = [
			R("只贴合", "衣服贴环境设置里的女模或男模。头发只贴环境设置里的头模，不要贴到身体上，也不要按头骨名或挂点名去套。每个部位单独一个 .blend，不要合并。这一步不要拆分，也不要打包。"),
			R("看情况贴", "按这个模型本来怎么穿就怎么贴。不要拿骨名清单、固定角度或某一件的案例去套。没有的结构不要做。"),
			R("带上参考", "贴合后交付的 .blend 里要带着用来贴的模型。衣服带女模或男模，头发带头模。打开文件就能看到衣服在人体上，或头发在头模上。"),
			R("贴图", "贴合时接着用上一步带过来的原贴图。不要丢 UV、材质槽和贴图节点，不要换成单色，外部图片继续打包在 .blend 里。")
		];
		var GLOBAL_PACK = [
			R("输入", "输入是上一步合格的贴合 .blend。每件一个 zipmod，不要打成一个包。"),
			R("路线", "用官方 ModdingTool（Unity 工程）打包。Unity 起不来要说明，不要偷偷改别的路线。"),
			R("Unity 版本", "必须是 Unity 2018.4.11f1。许可证有问题要我本人登录激活，不要向我要账号密码。"),
			R("FBX 导出", "从 .blend 导 FBX：apply_unit_scale=False，global_scale=1.0，只导 ARMATURE 和 MESH，add_leaf_bones=False，bake_anim=False，mesh_smooth_type=FACE，path_mode=AUTO，embed_textures=False，use_mesh_modifiers=False。"),
			R("贴图备齐", "每件备齐：主贴图、红黑遮罩、粉色法线、金属图、缩略图。这些都从源贴图来，不能用空图或单色顶替。FBX 的 embed_textures=False 只表示不嵌进 FBX，图片文件要留下并写进材质表。"),
			R("材质表", "每个 mod 的资源放在工程 Assets/<mod名> 下。material_map.tsv 用真 TAB 分隔、无 BOM：材质名、主贴图.png、遮罩.png、法线.png、金属.png。FBX 里的材质名和 Unity 抽出的 .mat 名可能不同，两个名字各写一行。"),
			R("包结构", "zipmod 根目录只留 manifest.xml 和 abdata。主包是 data_prefab_000.unity3d，additional_bones.json 和 prefab 一起放进这个主包。"),
			R("没打包的衣服", "Armature 下如果还有没打包的衣服（o_body_cf_0 除外），告诉我。"),
			R("已有的先复用", "已经做好并在游戏里能用的 zipmod 当基线，要重做前先问我。我说好了就立刻停手交付，不要顺手再修。出问题单点修，不要从原素材重建整条流水线。"),
			R("装机", "装之前先问我。游戏必须先关。只往游戏目录下叫 mods 的文件夹里装，别的 mod 备份或存档文件夹不要动。装之前清掉 BepInEx 下的 sideloader_zipmod_cache* 缓存，装完看 output_log.txt 里有没有 Successfully loaded N mods。"),
			R("交付说明", "改完必须部署，交付必须说明：改了哪个文件、我下一步看什么。没在游戏里亲眼看过的，写明“未目视确认”。")
		];

		/* ---------- shared pack lines (only reused where they really apply) ---------- */
		var P_AUTHOR = R("作者名", "author 用英文。写中文会被洗成空，日志报 InvalidXMLValue，打包直接失败。");
		var P_TEX = R("贴图名", "material_map.tsv 里贴图名要带扩展名，写 xxx.png。漏了的话 CSV 里 MainTex=0，游戏里没图，也调不了色。");
		var P_MASK = R("遮罩和法线", "缺 ColorMask 就用贴图转遮罩生成红黑遮罩，不能直接拿 coloursmask 当遮罩。法线先转成粉色法线再导入，设为 Normal Map。");
		var P_CLOTH_SHADER = R("着色器", "Hanmen/Clothes True Cutoff。BumpScale 默认 0.3，Glossiness 默认 0。");
		var P_LAYER = R("层级", "prefab 的 Layer 必须是 chara。");
		var P_BONES = R("额外骨", "带 CmpClothes 的 prefab 都要写 additional_bones.json，_end 结尾的骨不写。");
		var P_DYN = R("动骨", "有额外骨或摆动部件才加 DynamicBone。distance to object 默认 5，衣服有变形突起就改 0，并告诉我。");
		var P_DYN_HALF = R("半脱动骨", "做了半脱就有两套骨架，两套都要设动骨，参数一样。");
		var P_TWOMAT = R("两个材质", "一个部件有两个材质就不参与变色，提醒我先分离材质。");
		var P_ID = R("ID", "ID 不要和游戏自带、已装 mod 重复，重复了列表里就不出现。");
		var P_THREE_COLORS = function () { return R("变色", "3 组：MainTex、MainTex02、MainTex03。rendCheckVisible 填所有可见渲染器，rendNormal01/02/03 按不同主贴图分组，最多三组。"); };
		var P_TWO_COLORS = function (note) { return R("变色", "只有 2 组：MainTex、MainTex02。没有第三组，别承诺三个颜色页签。rendNormal01/02 按不同主贴图分组。" + (note || "")); };

		/* ---------- per part: split / fit / pack rules, each written for that type only ---------- */
		var BASE_PARTS = [
			{ id: "top", name: "上衣",
				split: [
					R("整件留住", "和衣身连成一片的裙摆、袖子跟着上衣走。不要按腰线或骨链把一件衣服撕成上衣和下装。"),
					R("皮肤", "皮肤材质是裸体，不交付。")
				],
				fit: [
					R("看情况贴", "按这件上衣本来怎么穿就贴到身上。袖子、披风、裙摆跟着衣服走。"),
					R("连衣裙", "连成一件的仍是一个 .blend，不要拆成上下两件。")
				],
				pack: [
					R("落点", "list type ftop，类别 240，prefab 后缀 _top，组件 CmpClothes。连衣裙整件当上衣打包，不要拆成上衣加下装两件。"),
					P_THREE_COLORS(),
					R("半脱", "全穿放 top0，半脱放 top00。两个集合和 Armature 同级，不放进 Armature，不混放。objTopDef 指全穿，objTopHalf 指半脱，不能填反。"),
					R("halfDressGroup", "就算没有半脱也设成 1，halfModelName 可以空。不设的话 objTopDef 是空的，列表里有、穿上没东西。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_DYN, P_DYN_HALF, P_LAYER, P_ID
				] },
			{ id: "bot", name: "下装",
				split: [
					R("只收分开的", "只有和上衣不是同一件的裙子、裤子才放下装。"),
					R("不要撕", "连在衣身上的裙摆留在上衣里，不要拆过来。")
				],
				fit: [
					R("看情况贴", "只有本来就分开的裙子、裤子才贴下装。按它本来怎么穿就贴。")
				],
				pack: [
					R("落点", "list type fbottom，类别 241，prefab 后缀 _bot，组件 CmpClothes。"),
					P_THREE_COLORS(),
					R("半脱", "全穿放 bot0，半脱放 bot00。两个集合和 Armature 同级，不放进 Armature，不混放。objBotDef 指全穿，objBotHalf 指半脱。别填成 objTop。"),
					R("halfDressGroup", "就算没有半脱也设成 2，halfModelName 可以空。不设的话 objBotDef 是空的，穿上没东西。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_DYN, P_DYN_HALF, P_LAYER, P_ID
				] },
			{ id: "bra", name: "内衣",
				split: [
					R("范围", "贴身的胸衣、抹胸、乳贴、贴片归内衣。"),
					R("材质和骨", "非皮肤材质，乳房骨主导。皮肤材质不是内衣。")
				],
				fit: [
					R("看情况贴", "贴身胸衣按它本来的位置贴。不要套用上衣的做法。")
				],
				pack: [
					R("落点", "list type fintop，类别 242，prefab 后缀 _bra，组件 CmpClothes。"),
					P_TWO_COLORS("官方内衣只有两套变色贴图槽。"),
					R("集合名", "集合仍叫 top0 / top00，不叫 bra0。只有 prefab 名带 _bra。objTopDef 指全穿，objTopHalf 指半脱。"),
					R("halfDressGroup", "就算没有半脱也设成 1，halfModelName 可以空。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_DYN_HALF, P_LAYER, P_ID
				] },
			{ id: "pants", name: "内裤",
				split: [
					R("范围", "内裤、丁字裤、贴纸归内裤。"),
					R("材质和骨", "非皮肤材质，Kosi、Siri 骨主导。皮肤材质不是内裤。")
				],
				fit: [
					R("看情况贴", "内裤按它本来的位置贴。不要套用下装或上衣的做法。")
				],
				pack: [
					R("落点", "list type finbottom，类别 243，prefab 后缀 _pants，组件 CmpClothes。"),
					P_TWO_COLORS(),
					R("集合名", "集合仍叫 top0 / top00，不叫 pants0。只有 prefab 名带 _pants。objBotDef 指全穿，objBotHalf 指半脱。"),
					R("halfDressGroup", "就算没有半脱也设成 2，halfModelName 可以空。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_DYN_HALF, P_LAYER, P_ID
				] },
			{ id: "glove", name: "手套",
				split: [
					R("两个条件", "必须同时满足：非皮肤材质，加上手骨或腕骨主导。"),
					R("裸手", "皮肤材质加手骨主导是裸手，不是手套。模型里没有手套就把这一槽留空，不要硬做。")
				],
				fit: [
					R("看情况贴", "手套按筒状贴到手上。不要压成扁片，袖套不要绑到手指上。")
				],
				pack: [
					R("落点", "list type fgloves，类别 244，prefab 后缀 _glove，组件 CmpClothes。"),
					P_TWO_COLORS(),
					R("半脱", "一般没有半脱，只填 objTopDef，不建 *00。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_LAYER, P_ID
				] },
			{ id: "panst", name: "裤袜",
				split: [
					R("范围", "连裤袜、吊带袜、全身紧身衣归裤袜。"),
					R("连脚", "腿骨和脚骨的连通岛一起带上，脚不要裁掉。"),
					R("材质", "皮肤材质是裸腿，不是裤袜。")
				],
				fit: [
					R("看情况贴", "裤袜按腿和脚连在一起贴。不要把脚裁掉。")
				],
				pack: [
					R("落点", "list type fpanst，类别 245，prefab 后缀 _kuwa，组件 CmpClothes。"),
					P_TWO_COLORS(),
					R("半脱", "全穿放 top0，半脱放 top00，两个集合和 Armature 同级。objTopDef 指全穿，objTopHalf 指半脱。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_DYN_HALF, P_LAYER, P_ID
				] },
			{ id: "socks", name: "袜子",
				split: [
					R("范围", "短袜、船袜、护踝，在小腿以下。"),
					R("别和裤袜混", "高过膝盖的先确认是不是裤袜。皮肤材质是裸腿，不是袜子。")
				],
				fit: [
					R("看情况贴", "袜子按小腿以下的筒状贴。不要套裤袜的做法。")
				],
				pack: [
					R("落点", "list type fsocks，类别 246，prefab 后缀 _sock，组件 CmpClothes。"),
					P_TWO_COLORS(),
					R("半脱", "一般没有半脱，不建 *00。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_LAYER, P_ID
				] },
			{ id: "shoe", name: "鞋",
				split: [
					R("两个条件", "脚骨主导，并且不是皮肤材质，才是鞋。皮肤材质加脚骨主导是裸脚，不交付。"),
					R("材质", "鞋可能是发材质或 Dress 材质，骨是 DEF-foot、toe、shin 这类。"),
					R("看高度", "脚踝高度（y 约 0–17cm）的发材质岛是鞋或脚饰，不是头发。")
				],
				fit: [
					R("先转脚", "高跟鞋让脚去适应鞋床，不要为了保持平脚把鞋撑宽、压低。平底鞋只对尺寸和位置，不转脚。"),
					R("三段", "cf_J_Foot01 管脚踝，Foot02 管脚背斜率和脚掌下压，Toes01 补偿前掌和鞋头。先小角度试旋转方向，左右可以不同号。不要拿另一双鞋的角度当这双鞋的角度。"),
					R("再放鞋", "脚跟要承住，鞋床斜率贴合，前掌接触，鞋头留余量。保留鞋跟高度、鞋底弧线和原来的左右不对称。"),
					R("鞋面", "最后才小修鞋筒、脚背、鞋头。推挤把鞋尖拉长或相交变多，就退回上一步，不要继续推。"),
					R("权重脚本", "静态贴合先不要跑鞋权重脚本。那是脚姿摆好之后才做的权重处理，不是自动贴合。要跑时必须换一个输出路径。")
				],
				pack: [
					R("落点", "list type fshoes，类别 247，prefab 后缀 _shoe，组件 CmpClothes。"),
					P_TWO_COLORS(),
					R("半脱", "一般没有半脱，不建 *00。"),
					R("高跟参数", "高跟鞋才写 AI_HeelsData，它由 HS2Heelz 插件读，不是游戏本体。平底鞋不用写。"),
					R("heel id", "必须等于这双鞋 CSV 里的 item id。"),
					R("三个旋转", "foot01、foot02、toes01 的 X 旋转。foot01 和 foot02 范围 -35 到 35，toes01 没有上限。超范围就设成极限值并告诉我。"),
					R("负角度", "需要负角度就把 min 和 max 两个属性整对省略。写了会把负的 foot01 钳成 0。"),
					P_CLOTH_SHADER, P_TWOMAT, P_MASK, P_AUTHOR, P_TEX, P_BONES, P_LAYER, P_ID
				] },
			{ id: "acc", name: "饰品",
				split: [
					R("按个体", "每个饰品单独一个 .blend。头纱、翅膀、耳环这些是不同个体，不要并在一个文件里。"),
					R("同一个饰品", "同一个饰品的 sp1、sp1.1、sp1.2 放进同一个 .blend。"),
					R("自己加分支", "有几个个体，DSH 自己加几条分支。part 用 acc、acc2、acc3，name 写名字。不要开子代理来加分支。"),
					R("脚上的发材质", "发材质落在脚踝高度的岛是脚饰，不是头发。")
				],
				fit: [
					R("不做", "饰品不贴合。摆位置放到做成 mod 里，由 DSH 自己做。")
				],
				pack: [
					R("落点", "list type 按位置选 351–363，prefab 后缀 _sp1、_sp2，组件 CmpAccessory。"),
					R("摆位置", "做成 mod 时由 DSH 自己摆，不要开 Codex 子代理。先定穿在哪：351 头、352 耳、353 眼镜、354 脸、355 颈、356 肩、357 胸、358 腰、359 背、360 臂、361 手、362 腿、363 裆。再挂到对应的点，例如 N_Head_top、N_Chest、N_Waist、N_Hand_L/R。腰上的不要挂到头上。"),
					R("着色器", "Hanmen/Item Cutoff，cutoff 0.5，BumpScale 0.3，Glossiness 0。"),
					R("层级", "Layer 是 chara。trfMove01 是最大父级，trfMove02 留空。"),
					R("打包", "sp1 是骨骼或空对象、下面有很多子模型时，全做进 sp1。sp1.1、sp1.2 也做进同一个 prefab。"),
					R("变色", "只有一个材质的部件才参与变色。多个部件、主贴图不同时，以第一个部件为准，主贴图相同的并进同一组，其余不参与。有两个材质的，提醒我先分离材质。"),
					R("遮罩", "没有专用遮罩就用 black.png。法线先转粉色法线再导入。"),
					P_AUTHOR, P_TEX, P_DYN, P_ID
				] },
			{ id: "hair", name: "头发",
				split: [
					R("两个条件", "发材质，加头骨或发骨主导，才是头发。皮肤材质不是头发。"),
					R("脚上的发材质", "发材质落在脚踝高度的岛是鞋或脚饰，不归头发。"),
					R("头纱", "头纱按饰品处理，不放进头发。")
				],
				fit: [
					R("贴头模", "用环境设置里的头模文件来贴。不要拿女模、男模或身体网格当目标。"),
					R("不要套骨", "不要按头骨名、发际线或挂点名去对。那种贴法是错的。把头发放到头模上，让它包住头模，位置和大小跟头模对齐。"),
					R("交付带头模", "交付的 .blend 里既有贴好的头发，也有头模。打开就能看到头发在头模上。")
				],
				pack: [
					R("默认槽位", "默认当饰品·头部：list type acchead，组件 CmpAccessory。我说放到头发位置才用后发 hairback，类别 300，组件 CmpHair。"),
					R("渲染器", "tf 命名的放进头发渲染器，其他部件放进附属件渲染器。prefab 后缀 _tf。"),
					R("其他槽", "前发 301、侧发 302、扩展发 303 用 CmpAccessory。"),
					R("贴图", "头发的字段是 TexManifest、TexD、TexC，不是衣服那三页 MainTex。没有专用遮罩用 black.png。"),
					P_AUTHOR, P_TEX, P_LAYER, P_DYN, P_ID
				] }
		];

		/** The page works on PARTS; the accessory entry in BASE_PARTS is a template that can be added several times. */
		var PARTS = [];
		function rebuildParts() {
			var ids = state && state.accIds ? state.accIds : ["acc"];
			var list = [];
			BASE_PARTS.forEach(function (base) {
				if (base.id !== "acc") { list.push(base); return; }
				ids.forEach(function (id, index) {
					var saved = state && state.parts ? state.parts[id] : null;
					var label = saved && saved.label ? String(saved.label).trim() : "";
					list.push({ id: id, name: label || (index === 0 ? "饰品" : "饰品 " + (index + 1)), isAcc: true, split: base.split, fit: base.fit, pack: base.pack });
				});
			});
			PARTS = list;
		}

		/* ---------- environment settings ---------- */
		var ENV_FIELDS = [
			{ key: "root", label: "交付根目录", hint: "所有 .blend、预览图、zipmod 放在这里。", placeholder: "留空 = 工作区里的 hs2-pipeline 文件夹" },
			{ key: "head", label: "头模", hint: "头发只贴这个文件，不贴身体。", placeholder: "留空 = 让助手自己找" },
			{ key: "bodyFemale", label: "女模", hint: "女装贴这个身体。", placeholder: "留空 = 让助手自己找" },
			{ key: "bodyMale", label: "男模", hint: "男装贴这个身体。", placeholder: "留空 = 让助手自己找" },
			{ key: "blender", label: "Blender 程序", hint: "blender.exe 的完整路径。", placeholder: "留空 = 让助手自己找" },
			{ key: "unity", label: "Unity 2018.4.11f1 程序", hint: "只有第 3 步用，必须是 2018.4.11f1。", placeholder: "留空 = 让助手自己找" },
			{ key: "tool", label: "ModdingTool 工程文件夹", hint: "只有第 3 步用。官方 ModdingTool 的 Unity 工程。", placeholder: "留空 = 让助手自己找" },
			{ key: "game", label: "游戏目录", hint: "HoneySelect 2 文件夹，里面有 abdata 和 BepInEx。", placeholder: "留空 = 让助手自己找" },
			{ key: "codex", label: "Codex 调用命令", hint: "Codex 不在系统路径里，或要通过别的方式调用才填。", placeholder: "留空 = 标准的 codex exec 写法" }
		];

		/* ---------- state ---------- */
		function blankStage() { return { blend: "", autoBlend: "", prev: "", autoPrev: "", url: "", verdict: "", note: "", sent: 0, previewStamp: 0 }; }
		function blankPart() {
			return { on: true, label: "", split: blankStage(), fit: blankStage(), packSent: 0, packBlend: "", draft: { fit: "", pack: "" }, touched: { fit: false, pack: false } };
		}
		function blankEnv() {
			return {
				root: "",
				head: "C:\\Users\\17262\\Desktop\\mod制作\\mod制作\\hs2头发定位.obj",
				bodyFemale: "C:\\Users\\17262\\Desktop\\mod制作\\mod制作\\body_女.fbx",
				bodyMale: "C:\\Users\\17262\\Desktop\\mod制作\\mod制作\\body_男.fbx",
				blender: "", unity: "", tool: "", game: "", codex: ""
			};
		}

		function freshState() {
			var parts = {};
			BASE_PARTS.forEach(function (p) { parts[p.id] = blankPart(); });
			return { id: "", name: "未立项", folder: "", founded: false, sourcePath: "", splitSent: 0, splitDraft: "", splitTouched: false, open: {}, accIds: ["acc"], parts: parts };
		}

		var book = { activeId: "", env: blankEnv(), projects: [] };
		var state = freshState();
		state.id = newId();
		book.projects.push(state);
		book.activeId = state.id;
		rebuildParts();
		var page = null;
		var toastEl = null;
		var entry = null;

		function newId() {
			var stamp = new Date();
			var pad = function (n) { return (n < 10 ? "0" : "") + n; };
			return stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + "-" + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
		}

		function unpackProject(parsed) {
			var next = freshState();
			next.id = typeof parsed.id === "string" && parsed.id ? parsed.id : newId();
			next.name = typeof parsed.name === "string" && parsed.name ? parsed.name : "未立项";
			next.folder = typeof parsed.folder === "string" ? parsed.folder : "";
			next.founded = !!parsed.founded;
				if (Array.isArray(parsed.accIds)) {
					next.accIds = parsed.accIds.filter(function (id) { return typeof id === "string" && /^acc\d*$/.test(id); });
					next.accIds.forEach(function (id) { if (!next.parts[id]) next.parts[id] = blankPart(); });
				}
				next.sourcePath = typeof parsed.sourcePath === "string" ? parsed.sourcePath : "";
				next.splitSent = typeof parsed.splitSent === "number" ? parsed.splitSent : 0;
				next.splitDraft = typeof parsed.splitDraft === "string" ? parsed.splitDraft : "";
				next.splitTouched = !!parsed.splitTouched;
				if (parsed.open && typeof parsed.open === "object") next.open = parsed.open;
				var held = state;
				state = next;
				rebuildParts();
				state = held;
				PARTS.forEach(function (p) {
					var saved = parsed.parts && parsed.parts[p.id];
					if (!saved) return;
					var item = next.parts[p.id];
					item.on = saved.on !== false;
					item.packSent = typeof saved.packSent === "number" ? saved.packSent : 0;
					item.packBlend = typeof saved.packBlend === "string" ? saved.packBlend : "";
					item.packAuto = typeof saved.packAuto === "string" ? saved.packAuto : "";
					item.autoZip = typeof saved.autoZip === "string" ? saved.autoZip : "";
					item.searchName = typeof saved.searchName === "string" ? saved.searchName : "";
					item.label = typeof saved.label === "string" ? saved.label : "";
					["split", "fit"].forEach(function (s) {
						var st = saved[s];
						if (!st) return;
						item[s].blend = typeof st.blend === "string" ? st.blend : "";
						item[s].autoBlend = typeof st.autoBlend === "string" ? st.autoBlend : "";
						item[s].prev = typeof st.prev === "string" ? st.prev : "";
						item[s].autoPrev = typeof st.autoPrev === "string" ? st.autoPrev : "";
						item[s].note = typeof st.note === "string" ? st.note : "";
						item[s].verdict = st.verdict === "ok" || st.verdict === "bad" ? st.verdict : "";
						item[s].sent = typeof st.sent === "number" ? st.sent : 0;
						item[s].previewStamp = typeof st.previewStamp === "number" ? st.previewStamp : 0;
					});
					["fit", "pack"].forEach(function (s) {
						if (saved.draft && typeof saved.draft[s] === "string") item.draft[s] = saved.draft[s];
						item.touched[s] = !!(saved.touched && saved.touched[s]);
					});
				});
				return next;
		}

		function load() {
			try {
				var raw = window.localStorage.getItem(LS_KEY) || window.localStorage.getItem("dsh-hs2-pipeline.v4");
				if (!raw) return;
				var parsed = JSON.parse(raw);
				var older = window.localStorage.getItem("dsh-hs2-pipeline.v4");
				if (older && older !== raw) {
					try {
						var oldParsed = JSON.parse(older);
						var oldList = Array.isArray(oldParsed.projects) ? oldParsed.projects : [oldParsed];
						var curList = Array.isArray(parsed.projects) ? parsed.projects : [];
						var ids = {};
						curList.forEach(function (p) { if (p && p.id) ids[p.id] = true; });
						oldList.forEach(function (p) {
							if (p && p.id && !ids[p.id] && (p.founded || p.folder || p.sourcePath)) curList.push(p);
						});
						parsed.projects = curList;
					} catch (error) { /* 旧档读不了就只用现在这份 */ }
				}
				ENV_FIELDS.forEach(function (f) {
					if (parsed.env && typeof parsed.env[f.key] === "string") book.env[f.key] = parsed.env[f.key];
				});
				var list = Array.isArray(parsed.projects) ? parsed.projects : [parsed];
				book.projects = list.map(unpackProject);
				if (!book.projects.length) book.projects = [unpackProject({})];
				book.activeId = book.projects.some(function (p) { return p.id === parsed.activeId; }) ? parsed.activeId : book.projects[0].id;
				state = book.projects.filter(function (p) { return p.id === book.activeId; })[0];
				rebuildParts();
			} catch (error) {
				console.warn("[dsh-hs2-pipeline] load failed:", error);
			}
		}

		function packOne(proj) {
			var parts = {};
			Object.keys(proj.parts || {}).forEach(function (id) {
				var item = proj.parts[id];
				if (!item || !item.split || !item.fit) return;
				parts[id] = {
					on: item.on !== false, label: item.label || "", packSent: item.packSent || 0,
					packBlend: item.packBlend || "", packAuto: item.packAuto || "", autoZip: item.autoZip || "", searchName: item.searchName || "",
					draft: item.draft || { fit: "", pack: "" }, touched: item.touched || { fit: false, pack: false }
				};
				["split", "fit"].forEach(function (s) {
					var st = item[s];
					parts[id][s] = {
						blend: st.blend || "", autoBlend: st.autoBlend || "", prev: st.prev || "", autoPrev: st.autoPrev || "",
						note: st.note || "", verdict: st.verdict || "", sent: st.sent || 0, previewStamp: st.previewStamp || 0
					};
				});
			});
			return {
				id: proj.id, name: proj.name, folder: proj.folder || "", founded: !!proj.founded,
				sourcePath: proj.sourcePath || "", splitSent: proj.splitSent || 0, splitDraft: proj.splitDraft || "",
				splitTouched: !!proj.splitTouched, open: proj.open || {}, accIds: proj.accIds || ["acc"], parts: parts
			};
		}

		function save() {
			try {
				var projects = book.projects.map(packOne);
				var seen = {};
				projects = projects.filter(function (p) {
					if (!p.id || seen[p.id]) return false;
					seen[p.id] = true;
					return true;
				});
				window.localStorage.setItem(LS_KEY, JSON.stringify({
					activeId: state.id,
					env: book.env,
					projects: projects
				}));
			} catch (error) {
				console.warn("[dsh-hs2-pipeline] save failed:", error);
			}
		}

		function esc(value) {
			return String(value == null ? "" : value)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;");
		}

		function partById(id) {
			for (var i = 0; i < PARTS.length; i++) if (PARTS[i].id === id) return PARTS[i];
			return null;
		}
		function selectedParts() { return PARTS.filter(function (p) { return state.parts[p.id].on; }); }
		function stageOf(id, stage) { return state.parts[id][stage]; }
		function hasPreview(st) { return !!(st.url || st.prev || st.autoPrev); }

		function rootDir() { return (book.env.root.trim() || "hs2-pipeline").replace(/[\\/]+$/, ""); }
		function isAbsolute(path) { return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path); }
		function projectSlug() {
			var name = state.name && state.name !== "未立项" ? state.name : "project";
			return state.id + "-" + String(name).replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
		}
		function jobDir() {
			if (state.folder) return state.folder.replace(/[\\/]+$/, "");
			return rootDir() + "\\" + projectSlug();
		}
		function stageDir(stage) { return jobDir() + "\\" + (stage === "split" ? "01-split" : stage === "fit" ? "02-fit" : "03-mod"); }
		function expectedBlend(id, stage) { return stageDir(stage) + "\\" + id + "\\" + id + "_" + stage + ".blend"; }
		function expectedPreview(id, stage) { return stageDir(stage) + "\\" + id + "\\" + id + "_" + stage + "_preview.png"; }
		function expectedZip(id) { return stageDir("pack") + "\\" + id + ".zipmod"; }
		function gameSearchName(part) {
			var item = state.parts[part.id];
			if (item && item.searchName) return item.searchName;
			var project = state.name && state.name !== "未立项" ? state.name.trim() : "";
			if (part.isAcc) {
				var label = item && item.label ? item.label.trim() : "";
				var tail = label || part.name;
				return project ? project + " " + tail : tail;
			}
			return project || part.name;
		}
		function activeBlend(id, stage) { return stageOf(id, stage).blend || expectedBlend(id, stage); }
		function packInput(id) {
			var part = partById(id);
			if (part && part.isAcc) return state.parts[id].packBlend || activeBlend(id, "split");
			return state.parts[id].packBlend || activeBlend(id, "fit");
		}
		function getBlend(id, stage) {
			if (stage === "pack") return state.parts[id].packBlend || state.parts[id].packAuto || "";
			var st = stageOf(id, stage);
			return st.blend || st.autoBlend || "";
		}
		function setBlend(id, stage, value) {
			if (stage === "pack") state.parts[id].packBlend = value;
			else stageOf(id, stage).blend = value;
		}

		function toast(text) {
			if (toastEl === null) {
				toastEl = document.createElement("div");
				toastEl.setAttribute("data-hs2p-toast", "");
				toastEl.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:100000;max-width:min(620px,92vw);padding:12px 16px;border-radius:8px;background:#fff;color:#1b1e23;font:16px/1.5 'Microsoft YaHei','Segoe UI',sans-serif;border:1px solid #5b7089";
				document.body.appendChild(toastEl);
			}
			toastEl.textContent = text;
			toastEl.style.display = "block";
			window.clearTimeout(toastEl._t);
			toastEl._t = window.setTimeout(function () { toastEl.style.display = "none"; }, 6000);
		}

		/* ---------- prompts: global rules + file locations, then two lines for Codex ---------- */
		function envBlock(needUnity) {
			var e = book.env;
			var root = rootDir();
			var lines = ["环境（没给路径的，你先在本机自己找，找不到就停下来问我，不要编路径）："];
			lines.push("- 交付根目录：" + root + (isAbsolute(root) ? "" : "（相对当前工作目录，先换成绝对路径，之后所有路径用绝对路径并回报）"));
			lines.push("- Blender：" + (e.blender.trim() || "没给。找 blender.exe，用 -b --background --python 跑脚本"));
			lines.push("- 头模：" + (e.head.trim() || "没给。找头发定位用的头模，找不到就问，不要编路径"));
			lines.push("- 女模：" + (e.bodyFemale.trim() || "没给。找女体，找不到就问，不要编路径"));
			lines.push("- 男模：" + (e.bodyMale.trim() || "没给。找男体，找不到就问，不要编路径"));
			if (needUnity) {
				lines.push("- Unity：" + (e.unity.trim() || "没给。必须是 2018.4.11f1"));
				lines.push("- ModdingTool 工程：" + (e.tool.trim() || "没给。官方 ModdingTool 的 Unity 工程"));
				lines.push("- 游戏目录：" + (e.game.trim() || "没给。里面有 abdata 和 BepInEx 的 HoneySelect 2 文件夹"));
			}
			return lines.join("\n");
		}

		function codexLines() {
			var lines = [
				"交给 Codex 子代理处理。你自己不要做，它返回后也不要打开、不要检查。",
				"Codex 子代理要选对：选能改交付目录里文件的那个，不要选只读的。"
			];
			if (book.env.codex.trim()) lines.push("调用：" + book.env.codex.trim());
			return lines.join("\n");
		}

		function ruleText(list) {
			return list.map(function (rule) { return "- " + rule.t + "：" + rule.d; }).join("\n");
		}

		function noteLines(stage, scope) {
			return scope.map(function (p) {
				var st = stageOf(p.id, stage);
				return st.verdict === "bad" && st.note.trim() ? p.name + " 的返工意见：" + st.note.trim() : "";
			}).filter(Boolean).join("\n");
		}

		function outputLines(stage, scope) {
			return scope.map(function (p) {
				return "- " + p.name + "（part=" + p.id + "）：.blend " + expectedBlend(p.id, stage) + "\n  预览图 " + expectedPreview(p.id, stage);
			}).join("\n");
		}

		function buildSplit(ids) {
			var scope = ids.map(partById);
			var notes = noteLines("split", scope);
			var redo = ids.length === 1 && stageOf(ids[0], "split").sent > 0;
			return [
				redo ? "【HS2 · 第 1 步 拆分 · 只返工 " + scope[0].name + "】" : "【HS2 · 第 1 步 拆分】",
				"本次部位：" + scope.map(function (p) { return p.name; }).join("、"),
				"素材：" + (state.sourcePath.trim() || "（我还没填，先问我）"),
				"",
				envBlock(false),
				"",
				"文件位置：",
				outputLines("split", scope),
				"",
				"整体规则：",
				ruleText(GLOBAL_SPLIT),
				notes ? "\n" + notes : "",
				"",
				codexLines(),
				"",
				reportBlock("split")
			].join("\n");
		}

		function buildFit(ids) {
			var scope = ids.map(partById);
			var notes = noteLines("fit", scope);
			var redo = ids.length === 1 && stageOf(ids[0], "fit").sent > 0;
			var inputs = scope.map(function (p) { return "- " + p.name + " 的输入：" + activeBlend(p.id, "split"); }).join("\n");
			return [
				redo ? "【HS2 · 第 2 步 贴合 · 只返工 " + scope[0].name + "】" : "【HS2 · 第 2 步 贴合】",
				"本次部位：" + scope.map(function (p) { return p.name; }).join("、"),
				"",
				envBlock(false),
				"",
				"文件位置。输入：",
				inputs,
				"输出：",
				outputLines("fit", scope),
				"",
				"整体规则：",
				ruleText(GLOBAL_FIT),
				"",
				"这一次各部位：",
				scope.map(function (p) { return "【" + p.name + "】\n" + ruleText(p.fit); }).join("\n\n"),
				notes ? "\n" + notes : "",
				"",
				codexLines(),
				"",
				reportBlock("fit")
			].join("\n");
		}

		function buildPack(ids) {
			var scope = ids.map(partById).filter(Boolean);
			var acc = scope.filter(function (p) { return p.isAcc; });
			var rest = scope.filter(function (p) { return !p.isAcc; });
			var inputs = scope.map(function (p) {
				return "- " + p.name + " 的输入：" + packInput(p.id) + "\n  输出 zipmod：" + expectedZip(p.id) + "\n  游戏内搜索名：" + gameSearchName(p);
			}).join("\n");
			var who = [];
			if (rest.length) who.push(codexLines());
			if (acc.length) who.push("饰品不贴合。做成 mod 时你自己把饰品摆到该挂的位置，不要为饰品开 Codex 子代理。先定穿在哪：351 头、352 耳、353 眼镜、354 脸、355 颈、356 肩、357 胸、358 腰、359 背、360 臂、361 手、362 腿、363 裆。再挂到对应的点，例如 N_Head_top、N_Chest、N_Waist、N_Hand_L/R。腰上的不要挂到头上。");
			return [
				"【HS2 · 第 3 步 做成 mod】",
				"本次部位：" + scope.map(function (p) { return p.name; }).join("、"),
				"",
				envBlock(true),
				"",
				"文件位置：",
				inputs,
				"",
				"整体规则：",
				ruleText(GLOBAL_PACK),
				"",
				who.join("\n\n"),
				"",
				reportBlock("pack")
			].join("\n");
		}

		function buildFor(step, ids) {
			return step === "split" ? buildSplit(ids) : step === "fit" ? buildFit(ids) : buildPack(ids);
		}

		function reportBlock(stage) {
			return [
				"文件写完后立刻更新本项目 _logs/result.json（不要自己 POST 上报接口；桌面端宿主会拒绝外部 POST，Web 也要鉴权）。",
				"result.json 用 UTF-8，格式例如：",
				'{"jobId":"' + state.id + '","root":"<本项目绝对路径>","stage":"' + stage + '","parts":[{"part":"<部位id>","blend":"<绝对路径>","preview":"<绝对路径>"}]}',
				"只列入已经写出且路径真实存在的部位；.blend 和预览图都要写上。页面每几秒会自动收回。",
				stage === "pack" ? "做成 mod 的项在 parts 里再加 zip 和 name。zip 填 zipmod 绝对路径。name 填上面的游戏内搜索名，并写进 CSV 的 Name 和 ZH_CN，游戏里就搜这个。" : "饰品按个体写。每一项的 part 用 acc、acc2、acc3，name 写这个饰品的名字。页面会按这些自己加分支。不要自己编别的 id。",
				"路径必须落在本项目文件夹里。"
			].filter(Boolean).join("\n");
		}

		/* ---------- composer bridge ---------- */
		function nextTick() { return new Promise(function (resolve) { window.setTimeout(resolve, 30); }); }

		function findComposerInput() {
			var seat = document.querySelector("[data-composer-seat]");
			var scope = seat !== null ? seat : document;
			var lexical = scope.querySelector("[data-composer-input]") || document.querySelector("[data-composer-input]");
			if (lexical && lexical.isContentEditable === true) return { element: lexical, kind: "lexical" };
			var textarea = scope.querySelector("textarea[data-phase]") || document.querySelector("textarea[data-phase]");
			if (textarea) return { element: textarea, kind: "textarea" };
			return null;
		}

		function placeCaretAtEnd(element) {
			var selection = document.getSelection();
			if (selection === null) return;
			var range = document.createRange();
			range.selectNodeContents(element);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		}

		async function insertIntoLexical(element, text) {
			var before = element.textContent || "";
			var piece = before && before.slice(-1) !== "\n" ? "\n" + text : text;
			element.focus();
			placeCaretAtEnd(element);
			await nextTick();
			try {
				var transfer = new DataTransfer();
				transfer.setData("text/plain", piece);
				element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
				await nextTick();
				if ((element.textContent || "").indexOf(text.slice(0, 24)) !== -1) return true;
			} catch (error) { /* paste seam missing */ }
			try {
				element.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: piece, bubbles: true, cancelable: true }));
			} catch (error) { /* InputEvent missing */ }
			await nextTick();
			return (element.textContent || "").indexOf(text.slice(0, 24)) !== -1;
		}

		function insertIntoTextarea(textarea, text) {
			var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
			var current = textarea.value;
			var piece = current === "" || current.slice(-1) === "\n" ? text : "\n" + text;
			if (setter && setter.set) setter.set.call(textarea, current + piece);
			else textarea.value = current + piece;
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			textarea.focus();
			var length = textarea.value.length;
			textarea.setSelectionRange(length, length);
			return true;
		}

		async function insertText(text) {
			var target = findComposerInput();
			if (target === null) return null;
			var ok = target.kind === "lexical" ? await insertIntoLexical(target.element, text) : insertIntoTextarea(target.element, text);
			return ok ? target.element : null;
		}

		function trySend(element) {
			var card = element.closest("[data-composer-card]") || element.closest("[data-composer-seat]") || document.body;
			var buttons = card.querySelectorAll("button");
			for (var i = 0; i < buttons.length; i++) {
				var button = buttons[i];
				if (button.disabled) continue;
				var hay = ((button.getAttribute("aria-label") || "") + " " + (button.getAttribute("title") || "") + " " + (button.textContent || "")).toLowerCase();
				if (hay.indexOf("停止") !== -1 || hay.indexOf("stop") !== -1) continue;
				if (hay.indexOf("发送") !== -1 || hay.indexOf("send") !== -1) {
					button.click();
					return true;
				}
			}
			element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
			return false;
		}

		function hidePage() { if (page) page.style.display = "none"; }

		function findNewSessionButton() {
			var marked = document.querySelector("[class$=\"_newSession\"]");
			if (marked && marked.tagName === "BUTTON") return marked;
			if (marked) {
				var inner = marked.querySelector("button");
				if (inner) return inner;
			}
			var all = document.querySelectorAll("button");
			for (var i = 0; i < all.length; i++) {
				var aria = all[i].getAttribute("aria-label") || "";
				var label = (all[i].textContent || "").trim();
				if (aria.indexOf("新建会话") !== -1 || aria.indexOf("新会话") !== -1 || aria.indexOf("New session") !== -1 || label === "新会话" || label === "New Session") return all[i];
			}
			return null;
		}

		function composerText(input) {
			if (!input) return "";
			return input.kind === "textarea" ? input.element.value : (input.element.textContent || "");
		}

		async function openNewChat() {
			var button = findNewSessionButton();
			if (!button) {
				toast("没找到「新会话」按钮，这次没有发送。");
				return false;
			}
			var before = findComposerInput();
			var beforeEl = before && before.element;
			var beforeHref = location.href;
			button.click();
			var wentAway = !beforeEl;
			for (var i = 0; i < 50; i++) {
				await new Promise(function (resolve) { window.setTimeout(resolve, 60); });
				if (beforeEl && !beforeEl.isConnected) wentAway = true;
				var input = findComposerInput();
				if (!input) { wentAway = true; continue; }
				var switched = wentAway || input.element !== beforeEl || location.href !== beforeHref;
				if (switched && !String(composerText(input)).trim()) return true;
			}
			toast("新对话还没打开，这次没有发送。");
			return false;
		}

		function suggestName() {
			var src = state.sourcePath.trim();
			if (!src) return "项目";
			var base = src.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
			return base || "项目";
		}

		async function establish() {
			if (!state.id) state.id = newId();
			if (!state.name || state.name === "未立项") state.name = suggestName();
			if (!state.founded || !state.folder) {
				try {
					var res = await fetch("/api/dsh-hs2-pipeline/project", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id: state.id, name: state.name, parent: book.env.root.trim() })
					});
					var data = await res.json();
					if (data && data.ok && data.path) state.folder = data.path;
				} catch (error) { /* 文件夹改由助手在工作区建好后回报 */ }
				state.founded = true;
			}
			if (!book.projects.some(function (p) { return p.id === state.id; })) book.projects.push(state);
			book.activeId = state.id;
			save();
			render();
		}

		async function deleteProject() {
			var name = state.name && state.name !== "未立项" ? state.name : "这个项目";
			var folder = (state.folder || "").replace(/[\\/]+$/, "");
			var ask = folder
				? "删除项目「" + name + "」，并删除这个文件夹里的全部文件？\n" + folder
				: "删除项目「" + name + "」？还没有项目文件夹。";
			if (!window.confirm(ask)) return;
			if (folder) {
				try {
					var res = await fetch("/api/dsh-hs2-pipeline/project/delete", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id: state.id, path: folder })
					});
					var data = await res.json();
					if (!data.ok) throw new Error((data.error && data.error.message) || "没删掉");
				} catch (error) {
					toast("文件没删掉，项目还留着：" + (error && error.message ? error.message : "请先重启一次 DSH"));
					return;
				}
			}
			var id = state.id;
			book.projects = book.projects.filter(function (p) { return p.id !== id; });
			if (!book.projects.length) {
				var fresh = freshState();
				fresh.id = newId();
				book.projects = [fresh];
			}
			state = book.projects[0];
			book.activeId = state.id;
			rebuildParts();
			save();
			render();
			toast(folder ? "项目和文件夹已删除。" : "项目已删除。");
		}

		function switchProject(id) {
			var next = book.projects.filter(function (p) { return p.id === id; })[0];
			if (!next || next.id === state.id) return;
			save();
			state = book.projects.filter(function (p) { return p.id === id; })[0];
			book.activeId = state.id;
			rebuildParts();
			save();
			render();
		}

		function adoptFolder(path) {
			var folder = String(path || "").replace(/[\\/]+$/, "");
			if (!folder) return;
			var existing = book.projects.filter(function (p) { return (p.folder || "").replace(/[\\/]+$/, "") === folder; })[0];
			if (existing) {
				switchProject(existing.id);
				toast("打开已有项目：" + (existing.name || folder));
				return;
			}
			save();
			var proj = freshState();
			var leaf = folder.split(/[\\/]/).pop() || "项目";
			var idMatch = leaf.match(/^([0-9]{8}-[0-9]{6})(?:-|$)/);
			proj.id = idMatch ? idMatch[1] : newId();
			proj.folder = folder;
			proj.founded = true;
			proj.name = idMatch ? (leaf.slice(idMatch[1].length).replace(/^-/, "") || leaf) : leaf;
			book.projects.push(proj);
			state = proj;
			book.activeId = proj.id;
			rebuildParts();
			save();
			render();
		}

		function openLightbox(src, title) {
			var old = page.querySelector(".lightbox");
			if (old) old.remove();
			if (!src) return;
			var box = document.createElement("div");
			box.className = "lightbox";
			box.setAttribute("role", "dialog");
			box.setAttribute("aria-label", title || "预览图");
			box.innerHTML = "<button type=\"button\" data-close>关闭</button><img alt=\"" + esc(title || "预览图") + "\" src=\"" + esc(src) + "\">";
			box.addEventListener("click", function (event) {
				if (event.target === box || event.target.getAttribute("data-close") !== null) box.remove();
			});
			page.appendChild(box);
		}

		function openDraft() {
			if (!state.founded) {
				toast("当前这个还没立项。填好素材，点「立项并拆分」。");
				return;
			}
			save();
			var draft = freshState();
			draft.id = newId();
			book.projects.push(draft);
			state = draft;
			book.activeId = draft.id;
			rebuildParts();
			save();
			render();
		}

		async function importJobsFromHost() {
			try {
				var res = await fetch("/api/dsh-hs2-pipeline/jobs");
				if (!res.ok) return;
				var data = await res.json();
				if (!data || !data.ok || !Array.isArray(data.jobs)) return;
				var changed = false;
				data.jobs.forEach(function (job) {
					if (!job || !job.id) return;
					var existing = book.projects.filter(function (p) { return p.id === job.id; })[0];
					var leaf = (job.root || "").split(/[\\/]/).pop() || job.id;
					var name = leaf.replace(new RegExp("^" + job.id + "-?"), "") || leaf;
					if (!existing) {
						var proj = freshState();
						proj.id = job.id;
						proj.name = name || job.id;
						proj.folder = job.root || "";
						proj.founded = !!(job.root || (job.itemCount > 0));
						book.projects.push(proj);
						changed = true;
					} else {
						if (job.root && job.root !== existing.folder) { existing.folder = job.root; changed = true; }
						if ((job.root || job.itemCount > 0) && !existing.founded) { existing.founded = true; changed = true; }
					}
				});
				if (changed) {
					if (!book.activeId && book.projects.length) book.activeId = book.projects[0].id;
					var active = book.projects.filter(function (p) { return p.id === book.activeId; })[0];
					if (active) state = active;
					save();
					render();
				}
			} catch (error) { /* host not ready */ }
		}

		async function pullJob() {
			if (!state || !state.id || !state.founded) return;
			try {
				var jobUrl = "/api/dsh-hs2-pipeline/job?id=" + encodeURIComponent(state.id);
				if (state.folder) jobUrl += "&root=" + encodeURIComponent(state.folder);
				var res = await fetch(jobUrl);
				if (!res.ok) {
					if (res.status === 403 || res.status === 401) return;
					return;
				}
				var data = await res.json();
				if (!data || !data.ok) return;
				var changed = false;
				if (data.root && data.root !== state.folder) { state.folder = data.root; changed = true; }
				(data.items || []).forEach(function (item) {
					if (item && /^acc\d*$/.test(item.part)) {
						if (state.accIds.indexOf(item.part) === -1) {
							state.accIds.push(item.part);
							state.accIds.sort(function (a, b) {
								var na = a === "acc" ? 1 : parseInt(a.slice(3), 10) || 1;
								var nb = b === "acc" ? 1 : parseInt(b.slice(3), 10) || 1;
								return na - nb;
							});
							changed = true;
						}
						if (!state.parts[item.part]) {
							state.parts[item.part] = blankPart();
							changed = true;
						}
						if (item.label && state.parts[item.part].label !== item.label) {
							state.parts[item.part].label = item.label;
							changed = true;
						}
					}
					var part = state.parts[item.part];
					if (!part) return;
					if (item.stage === "pack") {
						if (item.zip && item.zip !== part.autoZip) { part.autoZip = item.zip; changed = true; }
						if (item.searchName && item.searchName !== part.searchName) { part.searchName = item.searchName; changed = true; }
						if (item.blend && !part.packBlend && item.blend !== part.packAuto) { part.packAuto = item.blend; changed = true; }
						return;
					}
					var st = part[item.stage];
					if (!st) return;
					if (item.blend && (item.blend !== st.autoBlend || (item.updated && st.previewStamp && item.updated !== st.previewStamp))) {
						st.autoBlend = item.blend;
						if (!st.blend) st.verdict = "";
						changed = true;
					}
					if (item.preview && (item.preview !== st.autoPrev || (item.updated && st.previewStamp && item.updated !== st.previewStamp))) {
						st.autoPrev = item.preview;
						if (st.url) { URL.revokeObjectURL(st.url); st.url = ""; }
						st.verdict = "";
						changed = true;
					}
					if (item.updated && item.updated !== st.previewStamp) {
						st.previewStamp = item.updated;
						changed = true;
					}
				});
				if (changed) { save(); if (page && page.style.display !== "none") render(); }
			} catch (error) { /* 回报服务还没起来时，页面照常用手传 */ }
		}

		/* ---------- actions ---------- */
		function canFit(id) {
			var part = partById(id);
			if (part && part.isAcc) return false;
			var item = state.parts[id];
			return item.on && item.split.verdict === "ok" && hasPreview(item.split);
		}
		function canPack(id) {
			var item = state.parts[id];
			var part = partById(id);
			if (part && part.isAcc) return !!(item.on && (item.packBlend || (item.split.verdict === "ok" && hasPreview(item.split))));
			return !!(item.on && (item.packBlend || (item.fit.verdict === "ok" && hasPreview(item.fit))));
		}

		async function submit(step, ids, skippedNames) {
			if (!state.sourcePath.trim()) {
				toast("先在最左边的框里填素材路径：zip、Blender 文件或文件夹。");
				return;
			}
			if (!ids.length) {
				toast(step === "fit" ? "没有拆分合格的部件。先在拆分的预览图框里放预览图并点合格。" : step === "pack" ? "没有贴合合格的部件。先在贴合的预览图框里放预览图并点合格。" : "先勾选要做的部件。");
				return;
			}
			var prompt;
			var reworkOne = ids.length === 1 && step !== "pack" && stageOf(ids[0], step).sent > 0;
			if (reworkOne) {
				await sendRework(ids[0], step);
				return;
			}
			var allSplit = step === "split" && ids.length === selectedParts().length;
			if (allSplit && state.splitTouched && state.splitDraft.trim()) prompt = state.splitDraft;
			else if (step !== "split" && ids.length === 1 && state.parts[ids[0]].touched[step] && state.parts[ids[0]].draft[step].trim()) prompt = state.parts[ids[0]].draft[step];
			else prompt = buildFor(step, ids);
			var freshChat = true;
			if (ids.length === 1) {
				var again = step === "pack" ? state.parts[ids[0]].packSent > 0 : stageOf(ids[0], step).sent > 0;
				if (again) freshChat = false;
			}
			if (freshChat) {
				var opened = await openNewChat();
				if (!opened) return;
			}
			var element = await insertText(prompt);
			if (!element) {
				toast("没有找到当前对话的输入框。先打开一个会话。");
				return;
			}
			var sent = trySend(element);
			if (document.activeElement && page && !page.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
			ids.forEach(function (id) {
				var item = state.parts[id];
				if (step === "pack") { item.packSent += 1; return; }
				var st = item[step];
				st.sent += 1;
				if (st.url) URL.revokeObjectURL(st.url);
				st.url = "";
				st.prev = "";
				st.verdict = "";
			});
			if (step === "split") state.splitSent += 1;
			save();
			var where = freshChat ? "新对话" : "当前对话";
			var tail = skippedNames && skippedNames.length ? " 这几件还没合格，先跳过：" + skippedNames.join("、") + "。" : "";
			toast((sent ? "已发到" + where + "，3D 会交给 Codex。" : "已写入" + where + "的输入框，直接发送。") + "做完后 .blend 和预览图会自己回到这个项目页。" + tail);
			render();
		}

		/** 全部贴合 / 全部做成 mod: every ticked part whose previous step is approved; the rest are named, never silently dropped. */
		function batch(step) {
			var ready = canFitOrPack(step);
			var skipped = selectedParts().filter(function (p) { return ready.indexOf(p.id) === -1; }).map(function (p) { return p.name; });
			submit(step, ready, skipped);
		}
		async function sendRework(partId, stage) {
			var part = partById(partId);
			var st = stageOf(partId, stage);
			var text = (st.note || "").trim();
			if (!part || !text) {
				toast("先在框里写下要改的地方。");
				return;
			}
			var blend = getBlend(partId, stage) || expectedBlend(partId, stage);
			var preview = st.prev || st.autoPrev || expectedPreview(partId, stage);
			var prompt = [
				"【返工 · " + part.name + " · " + (stage === "split" ? "拆分" : "贴合") + "】",
				"只改下面这些，别的不要动。原贴图、UV、材质槽和贴图节点都留着，不要换成单色。",
				text,
				"",
				"改完覆盖原来的文件，同步更新这一件的 .blend 和预览图。",
				".blend：" + blend,
				"预览图：" + preview,
				"然后更新本项目 _logs/result.json（不要 POST）：jobId " + state.id + "，stage " + stage + "，把这一件的 part/blend/preview 写进 parts。路径必须在本项目文件夹里。"
			].join("\n");
			var element = await insertText(prompt);
			if (!element) {
				toast("没有找到当前对话的输入框。先打开一个会话。");
				return;
			}
			var sent = trySend(element);
			if (document.activeElement && page && !page.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
			st.sent += 1;
			st.verdict = "";
			save();
			toast((sent ? "已发到当前对话。" : "已写入当前对话，直接发送。") + "只带了你写的修改，并让它更新 .blend 和预览图。");
			render();
		}

		function canFitOrPack(step) {
			return selectedParts().filter(function (p) { return step === "fit" ? canFit(p.id) : canPack(p.id); }).map(function (p) { return p.id; });
		}

		async function uploadBlend(id, stage, file) {
			toast("正在放入 " + file.name + " …");
			try {
				var res = await fetch("/api/dsh-drop-to-path/upload?name=" + encodeURIComponent(id + "-" + stage + "-" + file.name), { method: "POST", body: file });
				var data = await res.json();
				if (!data.ok || !data.path) throw new Error((data.error && data.error.message) || "上传失败");
				setBlend(id, stage, data.path);
				save();
				toast("已放入：" + file.name);
			} catch (error) {
				toast("文件太大或上传失败：" + error.message + "。改用「从电脑里选」或直接粘贴路径。");
			}
			render();
		}

		async function uploadPreview(id, stage, file) {
			var st = stageOf(id, stage);
			if (st.url) URL.revokeObjectURL(st.url);
			st.url = URL.createObjectURL(file);
			try {
				var res = await fetch("/api/dsh-drop-to-path/upload?name=" + encodeURIComponent(id + "-" + stage + "-" + file.name), { method: "POST", body: file });
				var data = await res.json();
				if (!data.ok || !data.path) throw new Error((data.error && data.error.message) || "上传失败");
				st.prev = data.path;
			} catch (error) {
				st.prev = "";
			}
			save();
			render();
		}

		/* ---------- view ---------- */
		function fold(key, summary, inner) {
			return "<details data-key=\"" + key + "\"" + (state.open[key] ? " open" : "") + "><summary>" + esc(summary) + "</summary>" + inner + "</details>";
		}
		function foldRules(key, summary, list) {
			return fold(key, summary, "<ul class=\"rules\">" + list.map(function (r) { return "<li><b>" + esc(r.t) + "</b>" + esc(r.d) + "</li>"; }).join("") + "</ul>");
		}

		function blendButton(part, stage, label) {
			return "<label class=\"file\">" + esc(label) + "<input type=\"file\" accept=\".blend\" data-act=\"blendfile\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\"></label>";
		}

		function blendNote(part, stage, expected) {
			var current = getBlend(part.id, stage);
			var base = "data-stage=\"" + stage + "\" data-part=\"" + part.id + "\"";
			var fileName = current ? current.split(/[\\/]/).pop() : "";
			return "<p class=\"blendnote " + (current ? "ok" : "none") + "\">" + (current ? "已放 .blend：" + esc(fileName) : "还没放 .blend。不放就用交付位置：" + esc(expected)) + "</p>" +
				"<button type=\"button\" data-act=\"open-blend\" " + base + (current ? "" : " disabled") + ">打开这个 .blend</button>" +
				fold("bl-" + stage + "-" + part.id, ".blend 路径，或从电脑里选",
					"<input data-act=\"blend\" " + base + " value=\"" + esc(current) + "\" placeholder=\"粘贴 .blend 文件路径\">" +
					"<button type=\"button\" data-act=\"pick-blend\" " + base + ">从电脑里选</button>");
		}

		async function openBlendFile(path) {
			if (!path) { toast("还没有 .blend 文件。"); return; }
			var name = path.split(/[\\/]/).pop();
			toast("正在打开 " + name + " …");
			try {
				var res = await fetch("/api/dsh-hs2-pipeline/open", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path: path, blender: (book.env.blender || "").trim() })
				});
				var data = await res.json();
				if (!data.ok) throw new Error((data.error && data.error.message) || "打不开");
				toast("已打开：" + name);
			} catch (error) {
				toast("打不开：" + (error && error.message ? error.message : "请先用启动脚本重启一次 DSH"));
			}
		}

		async function readApi(res) {
			var text = await res.text();
			try { return JSON.parse(text); }
			catch (error) {
				if (res.status === 404) throw new Error("打开接口还没加载，先用启动脚本重启一次 DSH");
				throw new Error(text ? text.slice(0, 80) : "打不开");
			}
		}

		async function openModFolder(partId) {
			var item = state.parts[partId];
			if (!item) return;
			var zip = item.autoZip || expectedZip(partId);
			var folder = zip.replace(/[\\/][^\\/]*$/, "");
			var project = (state.folder || "").replace(/[\\/]+$/, "");
			if (!isAbsolute(folder) && isAbsolute(project)) folder = project + "\\03-mod";
			if (!isAbsolute(folder) && !isAbsolute(project)) {
				toast("文件夹还不是绝对路径。等项目路径收回来再打开。");
				return;
			}
			toast("正在打开文件夹…");
			try {
				var res = await fetch("/api/dsh-hs2-pipeline/open", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ kind: "folder", path: folder, zip: isAbsolute(zip) ? zip : "", project: project })
				});
				var data = await readApi(res);
				if (!data.ok) throw new Error((data.error && data.error.message) || "打不开");
				toast("已打开文件夹。");
			} catch (error) {
				toast("打不开：" + (error && error.message ? error.message : "文件夹还没建好"));
			}
		}

		function skipBox(node, col, row, text) {
			return "<div class=\"box skip\" data-n=\"" + node + "\" style=\"grid-column:" + col + ";grid-row:" + row + "\"><span>" + esc(text || "这一件不做") + "</span></div>";
		}

		function promptFold(part, step, text) {
			var key = "pr-" + step + "-" + part.id;
			return fold(key, "提示词，点开可以改",
				"<textarea data-draft=\"" + step + ":" + part.id + "\">" + esc(text) + "</textarea>" +
				"<button type=\"button\" data-act=\"reset-draft\" data-step=\"" + step + "\" data-part=\"" + part.id + "\">按规则重写</button>");
		}

		function partBox(part, row) {
			var item = state.parts[part.id];
			var accExtra = part.isAcc
				? "<input data-act=\"acclabel\" data-part=\"" + part.id + "\" value=\"" + esc(item.label) + "\" placeholder=\"这是什么饰品？例如 头纱\">" +
					(state.accIds.length > 1 ? "<button type=\"button\" class=\"small\" data-act=\"del-acc\" data-part=\"" + part.id + "\">删掉这个饰品</button>" : "")
				: "";
			return "<div class=\"box part" + (item.on ? "" : " off") + "\" data-n=\"p:" + part.id + "\" style=\"grid-column:3;grid-row:" + row + "\">" +
				"<label><input type=\"checkbox\" data-act=\"toggle\" data-part=\"" + part.id + "\"" + (item.on ? " checked" : "") + "><b>" + esc(part.name) + "</b></label>" +
				accExtra +
				foldRules("rs-" + part.id, "这一类怎么拆", part.split) +
				"</div>";
		}

		function resultBox(part, stage, row, col, locked) {
			var item = state.parts[part.id];
			var nodeId = (stage === "split" ? "s:" : "f:") + part.id;
			if (!item.on) return skipBox(nodeId, col, row);
			if (locked) return skipBox(nodeId, col, row, "先让拆分合格，这里才开放");
			var st = item[stage];
			var have = hasPreview(st);
			var shown = st.url || (st.autoPrev ? "/api/dsh-hs2-pipeline/preview?job=" + encodeURIComponent(state.id) + "&part=" + encodeURIComponent(part.id) + "&stage=" + encodeURIComponent(stage) + "&t=" + encodeURIComponent(st.previewStamp || "") : "");
			var imgInner = shown
				? "<img alt=\"" + esc(part.name) + "的预览图，点击放大\" data-act=\"zoom\" data-src=\"" + esc(shown) + "\" src=\"" + esc(shown) + "\">"
				: (st.prev ? "<span>路径已填</span>" : "<span>缺预览图</span>");
			var thumb = "<div class=\"img" + (have ? " has" : " missing") + "\">" + imgInner +
				(shown ? "" : "<input type=\"file\" accept=\"image/*\" data-act=\"shot\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\" title=\"放预览图\">") +
				"</div>";
			var replace = shown ? "<label class=\"file\">换预览图<input type=\"file\" accept=\"image/*\" data-act=\"shot\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\"></label>" : "";
			var verdict = "<div class=\"verdict\">" +
				"<button type=\"button\" data-act=\"verdict\" data-v=\"ok\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\" class=\"" + (st.verdict === "ok" ? "on-ok" : "") + "\"" + (have ? "" : " disabled") + ">合格</button>" +
				"<button type=\"button\" data-act=\"verdict\" data-v=\"bad\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\" class=\"" + (st.verdict === "bad" ? "on-bad" : "") + "\">不合格</button></div>";
			var rework = "<textarea data-act=\"note\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\" placeholder=\"只写要改的地方，例如：袖口收紧一点\">" + esc(st.note) + "</textarea>" +
				"<button type=\"button\" class=\"go\" data-act=\"rework\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\">返工，只发这段</button>";
			return "<div class=\"box result\" data-n=\"" + nodeId + "\" style=\"grid-column:" + col + ";grid-row:" + row + "\">" +
				"<div class=\"shotrow\">" + thumb + "<div class=\"shotctl\">" + blendButton(part, stage, "放 .blend 文件") + replace + verdict + "</div></div>" +
				blendNote(part, stage, expectedBlend(part.id, stage)) +
				(have ? "" : "<p class=\"miss\">缺预览图，不能点合格。</p>") +
				rework +
				fold("sp-" + stage + "-" + part.id, "预览图路径", "<input data-act=\"shotpath\" data-stage=\"" + stage + "\" data-part=\"" + part.id + "\" value=\"" + esc(st.prev) + "\" placeholder=\"粘贴预览图在电脑上的路径\">") +
				"</div>";
		}

		function actionBox(part, step, row, col, enabled) {
			var item = state.parts[part.id];
			var node = (step === "fit" ? "fb:" : "pb:") + part.id;
			if (!item.on) return skipBox(node, col, row);
			var sent = step === "fit" ? item.fit.sent : item.packSent;
			var draft = item.touched[step] ? item.draft[step] : buildFor(step, [part.id]);
			var need = step === "fit" ? "先让拆分合格" : (part.isAcc ? "先让拆分合格" : "先让贴合合格，或者在下面放你自己的 .blend");
			var fromBlend = step === "pack" && part.isAcc ? activeBlend(part.id, "split") : activeBlend(part.id, "fit");
			var slot = step === "pack"
				? blendButton(part, "pack", "放 .blend 文件" + (part.isAcc ? "（拆分好的）" : "（贴合好的）")) + blendNote(part, "pack", fromBlend)
				: "<p class=\"muted\">输入：" + esc(activeBlend(part.id, "split")) + "</p>";
			var chat = part.isAcc && step === "pack"
				? "新对话。DSH 自己摆位置，不开子代理。"
				: (sent > 0 ? "返工接着当前对话" : "新对话。不带上一步的过程，只要那个 .blend。");
			return "<div class=\"box act\" data-n=\"" + node + "\" style=\"grid-column:" + col + ";grid-row:" + row + "\">" +
				"<div class=\"acttitle\">" + (step === "fit" ? "贴合" : "做成 mod") + "</div>" +
				"<p class=\"state\">" + (enabled ? (sent > 0 ? "已发到对话" : "可以开始") : need) + "</p>" +
				"<p class=\"chatkind\">" + chat + "</p>" +
				slot +
				"<button type=\"button\" class=\"go\" data-act=\"go-" + step + "\" data-part=\"" + part.id + "\"" + (enabled ? "" : " disabled") + ">" + (sent > 0 ? "返工，接着当前对话" : (step === "fit" ? "贴合这一件，新对话" : "做成 mod，新对话")) + "</button>" +
				foldRules("rl-" + step + "-" + part.id, "这一类的" + (step === "fit" ? "贴合" : "打包") + "规则", part[step]) +
				promptFold(part, step, draft) +
				"</div>";
		}

		function zipBox(part, row) {
			var item = state.parts[part.id];
			if (!item.on) return skipBox("z:" + part.id, 8, row);
			var zip = item.autoZip || expectedZip(part.id);
			return "<div class=\"box zip\" data-n=\"z:" + part.id + "\" style=\"grid-column:8;grid-row:" + row + "\">" +
				"<b>" + esc(part.name) + ".zipmod</b>" +
				"<p class=\"searchname\">游戏内搜索 <b>" + esc(gameSearchName(part)) + "</b></p>" +
				"<p class=\"muted\">交付位置：" + esc(zip) + "</p>" +
				"<button type=\"button\" data-act=\"open-folder\" data-part=\"" + part.id + "\">打开文件夹</button>" +
				"<p class=\"state\">" + (item.packSent > 0 ? "已发到对话" : "还没打包") + "</p>" +
				"</div>";
		}

		function tabBar() {
			var tabs = book.projects.filter(function (p) { return p && p.id; });
			return "<div class=\"tabs\" role=\"tablist\">" + tabs.map(function (p) {
				var label = p.founded ? (p.name || "未命名") : "新项目";
				return "<button type=\"button\" role=\"tab\" class=\"tab" + (p.id === state.id ? " on" : "") + "\" data-act=\"tab\" data-id=\"" + esc(p.id) + "\">" + esc(label) + "</button>";
			}).join("") + "<button type=\"button\" class=\"tab add\" data-act=\"new-project\">＋ 新项目</button>" +
				"<button type=\"button\" class=\"tab add\" data-act=\"pick-project\">选择项目文件夹</button>" +
				"<button type=\"button\" class=\"tab add\" data-act=\"delete-project\">删除这个项目</button></div>";
		}

		function rewriteAllPrompts() {
			book.projects.forEach(function (proj) {
				proj.splitTouched = false;
				proj.splitDraft = "";
				Object.keys(proj.parts || {}).forEach(function (id) {
					var item = proj.parts[id];
					if (!item) return;
					item.touched = { fit: false, pack: false };
					item.draft = { fit: "", pack: "" };
				});
			});
			save();
			render();
			toast("已按当前环境重写全部提示词。头模、女模、男模和其他路径都会写进新提示词。");
		}

		function envPanel() {
			var inner = "<p class=\"muted\">换了电脑的人先填这里。留空的项，提示词会让助手自己在本机找，找不到就问你。</p>" +
				ENV_FIELDS.map(function (f) {
					return "<label class=\"envrow\">" + esc(f.label) + "<input data-act=\"env\" data-key=\"" + f.key + "\" value=\"" + esc(book.env[f.key]) + "\" placeholder=\"" + esc(f.placeholder) + "\"><span class=\"muted\">" + esc(f.hint) + "</span></label>";
				}).join("");
			return "<div class=\"envbox\">" + fold("env", "环境设置（头模、女模、男模、路径、Blender、Unity、游戏目录、Codex）", inner) + "</div>";
		}

		function render() {
			if (!page) return;
			rebuildParts();
			var n = PARTS.length;
			var fitReady = canFitOrPack("fit").length;
			var packReady = canFitOrPack("pack").length;
			var html =
				"<header class=\"top\"><div><h1>做衣服 mod</h1>" +
				"<p>从左往右走，每个部件各走一条线。第一步之后都是 .blend 文件，每一步都要有预览图。</p></div>" +
				"<button type=\"button\" data-act=\"close\">关闭</button></header>" +
				tabBar() +
				"<div class=\"toolbar\">" +
					"<button type=\"button\" data-act=\"all-on\">部件全选</button>" +
					"<button type=\"button\" data-act=\"all-off\">全不选</button>" +
					"<button type=\"button\" data-act=\"add-acc\">＋ 添加饰品</button>" +
					"<button type=\"button\" class=\"go\" data-act=\"batch-fit\">全部贴合（可做 " + fitReady + " 件）</button>" +
					"<button type=\"button\" class=\"go\" data-act=\"batch-pack\">全部做成 mod（可做 " + packReady + " 件）</button>" +
					"<button type=\"button\" data-act=\"rewrite-prompts\">按当前环境重写全部提示词</button>" +
				"</div>" +
				envPanel() +
				"<div class=\"hbar\" id=\"hs2p-hbar\"><div></div></div>" +
				"<div class=\"flow\"><div class=\"grid\" id=\"hs2p-grid\">";
			var titles = ["素材", "拆分", "部件", "拆分的 .blend 和预览图", "贴合", "贴合的 .blend 和预览图", "做成 mod", "交付"];
			titles.forEach(function (t, i) {
				var extra = "";
				if (i === 4) extra = "<button type=\"button\" class=\"go small\" data-act=\"batch-fit\">全部贴合（" + fitReady + "）</button>";
				if (i === 6) extra = "<button type=\"button\" class=\"go small\" data-act=\"batch-pack\">全部做成 mod（" + packReady + "）</button>";
				html += "<div class=\"coltitle\" style=\"grid-column:" + (i + 1) + ";grid-row:1\"><span>" + esc(t) + "</span>" + extra + "</div>";
			});
			html += "<div class=\"box src\" data-n=\"src\" style=\"grid-column:1;grid-row:2 / span " + n + ";align-self:start\">" +
				"<label>项目名<input data-act=\"project-name\" value=\"" + esc(state.name === "未立项" ? "" : state.name) + "\" placeholder=\"例如 连衣裙\"></label>" +
				"<p class=\"muted\">" + esc(state.folder ? "本项目文件夹：" + state.folder : (state.founded ? "项目已建，等助手把工作区里的绝对路径传回来：" + jobDir() : "还没立项。点「立项并拆分」就会建这个项目的文件夹，路径收回来。")) + "</p>" +
				"<label>素材<input data-act=\"source\" value=\"" + esc(state.sourcePath) + "\" placeholder=\"zip、Blender 文件或文件夹的完整路径\"></label>" +
				"<div class=\"btns\"><button type=\"button\" data-act=\"browse\">浏览</button><button type=\"button\" data-act=\"clear-job\">重新开始</button></div>" +
				"<p class=\"muted\">交付目录：" + esc(jobDir()) + "</p></div>";
			html += "<div class=\"box step\" data-n=\"split\" style=\"grid-column:2;grid-row:2 / span " + n + ";align-self:start\">" +
				"<div class=\"steptitle\"><span>1</span>拆分</div>" +
				"<p class=\"state\">" + (state.splitSent > 0 ? "已发到对话" : "还没开始") + "</p>" +
				"<p class=\"chatkind\">" + (state.founded ? "接着这个项目。返工才留在当前对话，第一次拆分是新对话。" : "点下去就立项：建好这个项目的文件夹，并新开一个对话。") + "</p>" +
				"<button type=\"button\" class=\"go\" data-act=\"go-split\">" + (state.founded ? "继续拆分，发到新对话" : "立项并拆分") + "</button>" +
				foldRules("rules-split", "整体拆分规则", GLOBAL_SPLIT) +
				fold("prompt-split", "提示词，点开可以改",
					"<textarea data-draft=\"split\">" + esc(state.splitTouched ? state.splitDraft : buildSplit(selectedParts().map(function (p) { return p.id; }))) + "</textarea>" +
					"<button type=\"button\" data-act=\"reset-draft\" data-step=\"split\">按规则重写</button>") +
				"</div>";
			PARTS.forEach(function (part, i) {
				var row = i + 2;
				html += partBox(part, row);
				html += resultBox(part, "split", row, 4, false);
				if (part.isAcc) {
					html += skipBox("fb:" + part.id, 5, row, "饰品不贴合");
					html += skipBox("f:" + part.id, 6, row, "饰品不贴合");
				} else {
					html += actionBox(part, "fit", row, 5, canFit(part.id));
					html += resultBox(part, "fit", row, 6, !canFit(part.id));
				}
				html += actionBox(part, "pack", row, 7, canPack(part.id));
				html += zipBox(part, row);
			});
			html += "</div></div>" +
				"<div class=\"globals\">" +
					foldRules("g-preview", "预览图要求", PREVIEW) +
					foldRules("g-fit", "贴合整体规则", GLOBAL_FIT) +
					foldRules("g-pack", "打包整体规则", GLOBAL_PACK) +
				"</div>";
			var pageTop = page.scrollTop;
			var pageLeft = page.scrollLeft;
			var flowNode = page.querySelector(".flow");
			var flowTop = flowNode ? flowNode.scrollTop : 0;
			var flowLeft = flowNode ? flowNode.scrollLeft : 0;
			page.innerHTML = html;
			bindPage();
			function putBack() {
				page.scrollTop = pageTop;
				page.scrollLeft = pageLeft;
				var flow = page.querySelector(".flow");
				var bar = page.querySelector("#hs2p-hbar");
				if (flow) {
					flow.scrollTop = flowTop;
					flow.scrollLeft = flowLeft;
				}
				if (bar) bar.scrollLeft = flowLeft;
			}
			putBack();
			syncBar();
			scheduleArrows();
			window.requestAnimationFrame(function () {
				putBack();
				window.requestAnimationFrame(putBack);
			});
		}

		function syncBar() {
			var bar = page && page.querySelector("#hs2p-hbar");
			var flow = page && page.querySelector(".flow");
			if (!bar || !flow) return;
			bar.firstChild.style.width = flow.scrollWidth + "px";
		}

		/** Arrows are fixed to the grid, which scrolls as one piece, so they are drawn once per layout change, never on scroll. */
		var arrowTimer = 0;
		function scheduleArrows() {
			window.cancelAnimationFrame(arrowTimer);
			arrowTimer = window.requestAnimationFrame(function () {
				window.requestAnimationFrame(function () { syncBar(); drawArrows(); });
			});
		}

		function drawArrows() {
			var grid = page && page.querySelector("#hs2p-grid");
			if (!grid) return;
			var old = grid.querySelector("svg.arrows");
			if (old) old.remove();
			var ns = "http://www.w3.org/2000/svg";
			var gridRect = grid.getBoundingClientRect();
			var svg = document.createElementNS(ns, "svg");
			svg.setAttribute("class", "arrows");
			svg.setAttribute("width", String(Math.ceil(gridRect.width)));
			svg.setAttribute("height", String(Math.ceil(gridRect.height)));
			svg.setAttribute("aria-hidden", "true");
			var defs = document.createElementNS(ns, "defs");
			["#2b3a4d", "#9aa8b6"].forEach(function (color, i) {
				var marker = document.createElementNS(ns, "marker");
				marker.setAttribute("id", "hs2p-head-" + i);
				marker.setAttribute("viewBox", "0 0 10 10");
				marker.setAttribute("refX", "9");
				marker.setAttribute("refY", "5");
				marker.setAttribute("markerWidth", "9");
				marker.setAttribute("markerHeight", "9");
				marker.setAttribute("orient", "auto-start-reverse");
				var tip = document.createElementNS(ns, "path");
				tip.setAttribute("d", "M0 0 L10 5 L0 10 z");
				tip.setAttribute("fill", color);
				marker.appendChild(tip);
				defs.appendChild(marker);
			});
			svg.appendChild(defs);
			function el(node) { return grid.querySelector("[data-n=\"" + node + "\"]"); }
			function edge(node, side) {
				var rect = node.getBoundingClientRect();
				return { x: (side === "r" ? rect.right : rect.left) - gridRect.left, y: rect.top + rect.height / 2 - gridRect.top };
			}
			function link(fromNode, toNode, dim) {
				var a = el(fromNode);
				var b = el(toNode);
				if (!a || !b) return;
				var p = edge(a, "r");
				var q = edge(b, "l");
				var dx = Math.max(24, (q.x - p.x) / 2);
				var path = document.createElementNS(ns, "path");
				path.setAttribute("d", "M" + p.x + "," + p.y + " C" + (p.x + dx) + "," + p.y + " " + (q.x - dx) + "," + q.y + " " + (q.x - 2) + "," + q.y);
				path.setAttribute("fill", "none");
				path.setAttribute("stroke", dim ? "#9aa8b6" : "#2b3a4d");
				path.setAttribute("stroke-width", "2");
				if (dim) path.setAttribute("stroke-dasharray", "5 5");
				path.setAttribute("marker-end", "url(#hs2p-head-" + (dim ? 1 : 0) + ")");
				svg.appendChild(path);
			}
			link("src", "split", false);
			PARTS.forEach(function (part) {
				var id = part.id;
				var dim = !state.parts[id].on;
				link("split", "p:" + id, dim);
				link("p:" + id, "s:" + id, dim);
				if (part.isAcc) link("s:" + id, "pb:" + id, dim);
				else {
					link("s:" + id, "fb:" + id, dim);
					link("fb:" + id, "f:" + id, dim);
					link("f:" + id, "pb:" + id, dim);
				}
				link("pb:" + id, "z:" + id, dim);
			});
			grid.insertBefore(svg, grid.firstChild);
		}

		function bindPage() {
			function on(selector, handler) {
				var node = page.querySelector(selector);
				if (node) node.onclick = handler;
			}
			function each(selector, handler) { page.querySelectorAll(selector).forEach(handler); }
			function ids(list) { return list.map(function (p) { return p.id; }); }

			on("[data-act=\"close\"]", hidePage);
			on("[data-act=\"browse\"]", function () {
				nativePick({ kind: "file", filter: "source", title: "选择素材：zip、Blender 文件或文件夹", onPick: function (path) { state.sourcePath = path; save(); render(); } });
			});
			on("[data-act=\"all-on\"]", function () { PARTS.forEach(function (p) { state.parts[p.id].on = true; }); save(); render(); });
			on("[data-act=\"all-off\"]", function () { PARTS.forEach(function (p) { state.parts[p.id].on = false; }); save(); render(); });
			on("[data-act=\"rewrite-prompts\"]", function () { rewriteAllPrompts(); });
			on("[data-act=\"add-acc\"]", function () {
				var n = 2;
				while (state.accIds.indexOf("acc" + n) !== -1) n += 1;
				var id = "acc" + n;
				state.accIds.push(id);
				state.parts[id] = blankPart();
				rebuildParts();
				save();
				render();
			});
			each("[data-act=\"del-acc\"]", function (button) {
				button.onclick = function () {
					var id = button.getAttribute("data-part");
					if (state.accIds.length < 2) return;
					state.accIds = state.accIds.filter(function (x) { return x !== id; });
					delete state.parts[id];
					rebuildParts();
					save();
					render();
				};
			});
			each("[data-act=\"acclabel\"]", function (input) {
				input.oninput = function () { state.parts[input.getAttribute("data-part")].label = input.value; rebuildParts(); };
				input.onchange = function () { save(); render(); };
			});
			on("[data-act=\"clear-job\"]", function () {
				var keepSource = state.sourcePath;
				var keepId = state.id;
				var keepName = state.name;
				var keepFolder = state.folder;
				var keepFounded = state.founded;
				var keepEnv = book.env;
				PARTS.forEach(function (p) {
					["split", "fit"].forEach(function (s) { var url = state.parts[p.id][s].url; if (url) URL.revokeObjectURL(url); });
				});
				var fresh = freshState();
				fresh.id = keepId;
				fresh.name = keepName;
				fresh.folder = keepFolder;
				fresh.founded = keepFounded;
				fresh.sourcePath = keepSource;
				var index = book.projects.findIndex(function (p) { return p.id === keepId; });
				if (index >= 0) book.projects[index] = fresh;
				state = fresh;
				book.env = keepEnv;
				rebuildParts();
				save();
				render();
			});
			on("[data-act=\"go-split\"]", function () { establish().then(function () { submit("split", ids(selectedParts())); }); });
			on("[data-act=\"new-project\"]", function () { openDraft(); });
			on("[data-act=\"delete-project\"]", function () { deleteProject(); });
			on("[data-act=\"pick-project\"]", function () {
				nativePick({
					kind: "folder",
					title: "选择项目文件夹",
					onPick: function (path) { adoptFolder(path); }
				});
			});
			each("[data-act=\"tab\"]", function (button) {
				button.onclick = function () { switchProject(button.getAttribute("data-id")); };
			});
			each("[data-act=\"batch-fit\"]", function (button) { button.onclick = function () { batch("fit"); }; });
			each("[data-act=\"batch-pack\"]", function (button) { button.onclick = function () { batch("pack"); }; });
			each("[data-act=\"go-fit\"]", function (button) { button.onclick = function () { submit("fit", [button.getAttribute("data-part")]); }; });
			each("[data-act=\"go-pack\"]", function (button) { button.onclick = function () { submit("pack", [button.getAttribute("data-part")]); }; });

			var source = page.querySelector("[data-act=\"source\"]");
			if (source) {
				source.oninput = function () { state.sourcePath = source.value; };
				source.onchange = function () { state.sourcePath = source.value.trim(); save(); render(); };
			}
			var projectName = page.querySelector("[data-act=\"project-name\"]");
			if (projectName) {
				projectName.oninput = function () { state.name = projectName.value.trim() || "未立项"; };
				projectName.onchange = function () { save(); render(); };
			}
			each("[data-act=\"env\"]", function (input) {
				input.onchange = function () {
					book.env[input.getAttribute("data-key")] = input.value.trim();
					save();
					render();
				};
			});
			each("[data-act=\"toggle\"]", function (box) {
				box.onchange = function () { state.parts[box.getAttribute("data-part")].on = box.checked; save(); render(); };
			});
			each("[data-act=\"zoom\"]", function (img) {
				img.onclick = function (event) {
					event.preventDefault();
					event.stopPropagation();
					openLightbox(img.getAttribute("data-src") || img.getAttribute("src"), img.getAttribute("alt") || "预览图");
				};
			});
			each("[data-act=\"shot\"]", function (input) {
				input.onchange = function () {
					var file = input.files && input.files[0];
					if (file) uploadPreview(input.getAttribute("data-part"), input.getAttribute("data-stage"), file);
				};
			});
			each("[data-act=\"shotpath\"]", function (input) {
				input.onchange = function () {
					stageOf(input.getAttribute("data-part"), input.getAttribute("data-stage")).prev = input.value.trim();
					save();
					render();
				};
			});
			each("[data-act=\"blend\"]", function (input) {
				input.onchange = function () {
					var value = input.value.trim();
					if (value && !/\.blend$/i.test(value)) {
						toast("这里只收 .blend 文件。");
						input.value = "";
						value = "";
					}
					setBlend(input.getAttribute("data-part"), input.getAttribute("data-stage"), value);
					save();
					render();
				};
			});
			each("[data-act=\"pick-blend\"]", function (button) {
				button.onclick = function () {
					var partId = button.getAttribute("data-part");
					var stage = button.getAttribute("data-stage");
					nativePick({ kind: "file", filter: "blend", title: "选 .blend 文件", ext: ".blend", onPick: function (path) { setBlend(partId, stage, path); save(); render(); } });
				};
			});
			each("[data-act=\"open-blend\"]", function (button) {
				button.onclick = function () {
					openBlendFile(getBlend(button.getAttribute("data-part"), button.getAttribute("data-stage")));
				};
			});
			each("[data-act=\"open-folder\"]", function (button) {
				button.onclick = function () { openModFolder(button.getAttribute("data-part")); };
			});
			each("[data-act=\"blendfile\"]", function (input) {
				input.onchange = function () {
					var file = input.files && input.files[0];
					if (!file) return;
					if (!/\.blend$/i.test(file.name)) { toast("这里只收 .blend 文件。"); input.value = ""; return; }
					uploadBlend(input.getAttribute("data-part"), input.getAttribute("data-stage"), file);
				};
			});
			each("[data-act=\"verdict\"]", function (button) {
				button.onclick = function () {
					var st = stageOf(button.getAttribute("data-part"), button.getAttribute("data-stage"));
					var v = button.getAttribute("data-v");
					st.verdict = st.verdict === v ? "" : v;
					save();
					render();
				};
			});
			each("[data-act=\"note\"]", function (box) {
				box.oninput = function () { stageOf(box.getAttribute("data-part"), box.getAttribute("data-stage")).note = box.value; };
				box.onchange = function () { save(); };
			});
			each("[data-act=\"rework\"]", function (button) {
				button.onclick = function () {
					save();
					sendRework(button.getAttribute("data-part"), button.getAttribute("data-stage"));
				};
			});
			each("[data-draft]", function (box) {
				box.oninput = function () {
					var key = box.getAttribute("data-draft");
					if (key === "split") { state.splitDraft = box.value; state.splitTouched = true; }
					else {
						var bits = key.split(":");
						state.parts[bits[1]].draft[bits[0]] = box.value;
						state.parts[bits[1]].touched[bits[0]] = true;
					}
				};
				box.onchange = function () { save(); };
			});
			each("[data-act=\"reset-draft\"]", function (button) {
				button.onclick = function () {
					var step = button.getAttribute("data-step");
					var partId = button.getAttribute("data-part");
					if (step === "split") { state.splitTouched = false; state.splitDraft = ""; }
					else { state.parts[partId].touched[step] = false; state.parts[partId].draft[step] = ""; }
					save();
					render();
				};
			});

			var bar = page.querySelector("#hs2p-hbar");
			var flow = page.querySelector(".flow");
			if (bar && flow) {
				bar.addEventListener("scroll", function () {
					if (flow.scrollLeft !== bar.scrollLeft) flow.scrollLeft = bar.scrollLeft;
				}, { passive: true });
				flow.addEventListener("scroll", function () {
					if (bar.scrollLeft !== flow.scrollLeft) bar.scrollLeft = flow.scrollLeft;
				}, { passive: true });
			}
		}

		async function nativePick(opts) {
			toast(opts.kind === "folder" ? "正在打开系统的文件夹选择…" : "正在打开系统的文件选择…");
			try {
				var res = await fetch("/api/dsh-hs2-pipeline/pick", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ kind: opts.kind === "folder" ? "folder" : "file", filter: opts.filter || "" })
				});
				var data = await res.json();
				if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || "打不开");
				if (data.path) opts.onPick(data.path);
			} catch (error) {
				toast("系统选择框打不开，先用页面里的列表。");
				openBrowse(opts);
			}
		}

		async function browseApi(path, drives) {
			var query = drives ? "drives=1" : "path=" + encodeURIComponent(path || "");
			var res = await fetch("/api/dsh-drop-to-path/browse?" + query);
			var data = await res.json();
			if (!data.ok) throw new Error((data.error && data.error.message) || "读不了这个路径");
			return data;
		}

		function openBrowse(opts) {
			var old = document.getElementById("hs2p-browse");
			if (old) old.remove();
			var dialog = document.createElement("dialog");
			dialog.id = "hs2p-browse";
			dialog.setAttribute("aria-label", opts.title);
			dialog.innerHTML = "<form method=\"dialog\"><header><strong>" + esc(opts.title) + "</strong><button value=\"cancel\">关闭</button></header>" +
				"<div class=\"row\"><input data-path placeholder=\"完整路径\"><button type=\"button\" data-go>转到</button><button type=\"button\" data-up>上级</button><button type=\"button\" data-drives>磁盘</button></div>" +
				"<p data-status></p><div data-list></div>" +
				(opts.ext ? "" : "<div class=\"row\"><button type=\"button\" data-use-dir>用当前这个文件夹</button></div>") + "</form>";
			page.appendChild(dialog);
			var input = dialog.querySelector("[data-path]");
			var list = dialog.querySelector("[data-list]");
			var status = dialog.querySelector("[data-status]");
			var current = "";
			var parent = null;
			function paint(data) {
				current = data.path || "";
				parent = data.parent;
				input.value = current;
				list.replaceChildren();
				var shown = 0;
				(data.entries || []).forEach(function (item) {
					if (opts.ext && item.kind !== "directory" && item.name.toLowerCase().slice(-opts.ext.length) !== opts.ext) return;
					shown += 1;
					var row = document.createElement("button");
					row.type = "button";
					row.textContent = (item.kind === "directory" ? "文件夹  " : "文件  ") + item.name;
					row.onclick = function () {
						if (item.kind === "directory") loadDir(item.path, false);
						else choose(item.path);
					};
					list.appendChild(row);
				});
				status.textContent = shown + " 项" + (opts.ext ? "（只显示文件夹和 " + opts.ext + " 文件）" : "");
			}
			function loadDir(path, drives) {
				status.textContent = "正在读…";
				browseApi(path, drives).then(paint, function (error) { status.textContent = error.message; });
			}
			function choose(path) {
				dialog.close();
				opts.onPick(path);
			}
			dialog.querySelector("[data-go]").onclick = function () { loadDir(input.value, false); };
			dialog.querySelector("[data-up]").onclick = function () { parent ? loadDir(parent, false) : loadDir("", true); };
			dialog.querySelector("[data-drives]").onclick = function () { loadDir("", true); };
			var useDir = dialog.querySelector("[data-use-dir]");
			if (useDir) useDir.onclick = function () { if (current) choose(current); };
			dialog.addEventListener("close", function () { dialog.remove(); });
			dialog.showModal();
			loadDir("", false);
		}

		function ensureStyle() {
			var style = document.querySelector("style[data-plugin-css=\"dsh-hs2-pipeline\"]");
			if (!style) {
				style = document.createElement("style");
				style.dataset.plugin = "dsh-hs2-pipeline";
				style.dataset.pluginCss = "dsh-hs2-pipeline";
				document.head.appendChild(style);
			}
			style.textContent = [
				"[data-hs2p-page]{position:fixed;inset:0;z-index:99990;overflow:auto;overflow-anchor:none;box-sizing:border-box;padding:18px 24px 28px;background:#f3f5f7;color:#1b1e23;font:16px/1.55 'Microsoft YaHei','Segoe UI',sans-serif}",
				"[data-hs2p-page] *{box-sizing:border-box}",
				"[data-hs2p-page] h1{margin:0;font-size:28px;font-weight:600}",
				"[data-hs2p-page] p{margin:0}",
				"[data-hs2p-page] .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}",
				"[data-hs2p-page] .top p{margin-top:6px;color:#243040}",
				"[data-hs2p-page] .tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;padding-bottom:2px}",
				"[data-hs2p-page] .tab{border:1px solid #6f86a0;background:#fff;border-radius:8px 8px 0 0;padding:8px 14px;font:inherit;cursor:pointer;white-space:nowrap}",
				"[data-hs2p-page] .tab.on{background:#1b1e23;color:#fff;border-color:#1b1e23}",
				"[data-hs2p-page] .tab.add{background:#f3f5f7}",
				"[data-hs2p-page] .chatkind{color:#0b57d0;font-size:13px}",
				"[data-hs2p-page] .toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}",
				"[data-hs2p-page] .envbox{margin-bottom:10px;padding:10px 14px;background:#fff;border:1px solid #b9c5d1;border-radius:8px}",
				"[data-hs2p-page] .envbox details{border-top:0;padding-top:0}",
				"[data-hs2p-page] .envrow{display:flex;flex-direction:column;gap:2px;margin-top:8px;max-width:760px}",
				"[data-hs2p-page] .hbar{height:26px;overflow-x:scroll;overflow-y:hidden;margin-bottom:8px;background:#dfe6ed;border:1px solid #8aa0b8;border-radius:6px}",
				"[data-hs2p-page] .hbar>div{height:1px}",
				"[data-hs2p-page] .hbar::-webkit-scrollbar{height:24px}",
				"[data-hs2p-page] .hbar::-webkit-scrollbar-track{background:#dfe6ed}",
				"[data-hs2p-page] .hbar::-webkit-scrollbar-thumb{background:#4a5f78;border-radius:8px;border:4px solid #dfe6ed}",
				"[data-hs2p-page] .flow{overflow:auto;overflow-anchor:none;height:calc(100vh - 290px);min-height:360px;background:#fff;border:1px solid #b9c5d1;border-radius:8px;padding:20px}",
				"[data-hs2p-page] .grid{position:relative;display:grid;width:max-content;column-gap:84px;row-gap:12px;align-items:start}",
				"[data-hs2p-page] svg.arrows{position:absolute;left:0;top:0;pointer-events:none;z-index:0;overflow:visible}",
				"[data-hs2p-page] .coltitle{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:15px;font-weight:600;color:#243040;padding-bottom:4px;border-bottom:2px solid #1b1e23;position:relative;z-index:1;background:#fff}",
				"[data-hs2p-page] .box{position:relative;z-index:1;background:#fff;border:2px solid #2b3a4d;border-radius:8px;padding:12px 14px}",
				"[data-hs2p-page] .box.off{border-color:#9aa8b6;color:#5c6b7a}",
				"[data-hs2p-page] .skip{padding:8px 14px;font-size:14px;background:#f3f5f7;border-color:#9aa8b6;color:#5c6b7a}",
				"[data-hs2p-page] .src{width:280px}",
				"[data-hs2p-page] .step{width:270px;display:flex;flex-direction:column;gap:8px}",
				"[data-hs2p-page] .part{width:210px}",
				"[data-hs2p-page] .result{width:340px;display:flex;flex-direction:column;gap:8px}",
				"[data-hs2p-page] .act{width:240px;display:flex;flex-direction:column;gap:8px}",
				"[data-hs2p-page] .zip{width:250px;display:flex;flex-direction:column;gap:6px}",
				"[data-hs2p-page] .searchname{font-size:15px}",
				"[data-hs2p-page] .searchname b{font-size:18px}",
				"[data-hs2p-page] .steptitle{display:flex;align-items:center;gap:8px;font-size:22px;font-weight:600}",
				"[data-hs2p-page] .steptitle span{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#1b1e23;color:#fff;font-size:15px}",
				"[data-hs2p-page] .acttitle{font-size:19px;font-weight:600}",
				"[data-hs2p-page] .state{color:#0b57d0}",
				"[data-hs2p-page] .muted{margin-top:6px;color:#243040;font-size:13px;overflow-wrap:anywhere}",
				"[data-hs2p-page] .miss{color:#b3261e;font-size:14px}",
				"[data-hs2p-page] .blendslot{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:2px dashed #6f86a0;border-radius:8px;background:#f8fafc}",
				"[data-hs2p-page] .blendslot.has{border-style:solid;border-color:#146c2e;background:#f1f8f3}",
				"[data-hs2p-page] .blendhead{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:15px}",
				"[data-hs2p-page] .blendhead span.ok{color:#146c2e;overflow-wrap:anywhere}",
				"[data-hs2p-page] .blendhead span.none{color:#5c6b7a}",
				"[data-hs2p-page] .blendbtns{display:flex;gap:8px;flex-wrap:wrap}",
				"[data-hs2p-page] .blendslot .muted{margin-top:0}",
				"[data-hs2p-page] label{display:flex;flex-direction:column;gap:4px}",
				"[data-hs2p-page] .part label{flex-direction:row;align-items:center;gap:8px}",
				"[data-hs2p-page] .part b{font-size:18px}",
				"[data-hs2p-page] input,[data-hs2p-page] textarea{width:100%;border:1px solid #6f86a0;border-radius:6px;background:#fff;color:#1b1e23;font:inherit;padding:8px 10px}",
				"[data-hs2p-page] input[type=checkbox]{width:18px;height:18px;padding:0}",
				"[data-hs2p-page] textarea{min-height:130px;resize:vertical;font-size:14px}",
				"[data-hs2p-page] .result textarea{min-height:64px}",
				"[data-hs2p-page] button{border:1px solid #6f86a0;background:#fff;color:#1b1e23;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer}",
				"[data-hs2p-page] button.go{background:#0b57d0;border-color:#0b57d0;color:#fff}",
				"[data-hs2p-page] button.small{padding:3px 8px;font-size:13px;font-weight:400;white-space:nowrap}",
				"[data-hs2p-page] button.on-ok{background:#146c2e;border-color:#146c2e;color:#fff}",
				"[data-hs2p-page] button.on-bad{background:#b3261e;border-color:#b3261e;color:#fff}",
				"[data-hs2p-page] button:disabled{background:#e6ebf0;border-color:#c5ced6;color:#5c6b7a;cursor:not-allowed}",
				"[data-hs2p-page] button:focus-visible,[data-hs2p-page] input:focus-visible,[data-hs2p-page] textarea:focus-visible,[data-hs2p-page] summary:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}",
				"[data-hs2p-page] .btns,[data-hs2p-page] .verdict,[data-hs2p-page] .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}",
				"[data-hs2p-page] details{border-top:1px solid #d3dbe3;padding-top:6px}",
				"[data-hs2p-page] details>button,[data-hs2p-page] details>input{margin-top:6px}",
				"[data-hs2p-page] summary{cursor:pointer;color:#0b57d0;font-size:15px}",
				"[data-hs2p-page] details[open] summary{margin-bottom:6px}",
				"[data-hs2p-page] .rules{margin:0;padding-left:18px;font-size:14px;max-width:300px}",
				"[data-hs2p-page] .rules li{margin-bottom:6px}",
				"[data-hs2p-page] .rules b{display:block}",
				"[data-hs2p-page] .shotrow{display:flex;gap:10px;align-items:flex-start}",
				"[data-hs2p-page] .shotctl{display:flex;flex-direction:column;gap:6px;min-width:0}",
				"[data-hs2p-page] .shotctl .verdict{margin-top:0;flex-wrap:nowrap;gap:6px}",
				"[data-hs2p-page] .shotctl button,[data-hs2p-page] .shotctl .file{padding:5px 10px;font-size:14px}",
				"[data-hs2p-page] .img{position:relative;cursor:pointer;text-align:center;flex:none;width:96px;height:72px;border:1px dashed #6f86a0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#5c6b7a;font-size:13px;line-height:1.3;padding:4px;background:#f3f5f7;overflow:hidden}",
				"[data-hs2p-page] .img.missing{border-color:#b3261e;color:#b3261e}",
				"[data-hs2p-page] .img.has{cursor:zoom-in}",
				"[data-hs2p-page] .img img{width:100%;height:100%;object-fit:contain;cursor:zoom-in}",
				"[data-hs2p-page] .lightbox{position:fixed;inset:0;z-index:100001;background:rgba(20,24,28,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px}",
				"[data-hs2p-page] .lightbox img{max-width:92vw;max-height:84vh;background:#fff;object-fit:contain}",
				"[data-hs2p-page] .lightbox button{background:#fff}",
				"[data-hs2p-page] .img input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0}",
				"[data-hs2p-page] .blendnote{font-size:13px;overflow-wrap:anywhere}",
				"[data-hs2p-page] .blendnote.ok{color:#146c2e}",
				"[data-hs2p-page] .blendnote.none{color:#5c6b7a}",
				"[data-hs2p-page] .file{position:relative;display:inline-flex;width:max-content;border:1px solid #6f86a0;border-radius:6px;padding:7px 12px;background:#fff;cursor:pointer}",
				"[data-hs2p-page] .file input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0}",
				"[data-hs2p-page] .globals{display:flex;gap:24px;flex-wrap:wrap;margin-top:12px;padding:12px 16px;background:#fff;border:1px solid #b9c5d1;border-radius:8px}",
				"[data-hs2p-page] .globals details{border-top:0;padding-top:0}",
				"[data-hs2p-page] .globals .rules{max-width:640px}",
				"[data-hs2p-page] #hs2p-browse{width:min(720px,94vw);height:min(640px,86vh);padding:0;border:1px solid #6f86a0;border-radius:8px;background:#fff;color:#1b1e23}",
				"[data-hs2p-page] #hs2p-browse form{display:flex;flex-direction:column;gap:10px;height:100%;padding:14px}",
				"[data-hs2p-page] #hs2p-browse header{display:flex;justify-content:space-between;align-items:center}",
				"[data-hs2p-page] #hs2p-browse [data-list]{flex:1;overflow:auto;border:1px solid #d3dbe3}",
				"[data-hs2p-page] #hs2p-browse [data-list] button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e6ebf0;border-radius:0}"
			].join("");
		}

		function openPage() {
			ensureStyle();
			if (!page) {
				page = document.createElement("div");
				page.setAttribute("data-hs2p-page", "");
				page.setAttribute("role", "dialog");
				page.setAttribute("aria-label", "做衣服 mod");
				page.addEventListener("toggle", function (event) {
					var node = event.target;
					if (node && node.tagName === "DETAILS") {
						var key = node.getAttribute("data-key");
						if (key) {
							if (node.open) state.open[key] = true;
							else delete state.open[key];
							save();
						}
						scheduleArrows();
					}
				}, true);
				page.addEventListener("load", scheduleArrows, true);
				window.addEventListener("resize", scheduleArrows);
				document.body.appendChild(page);
			}
			page.style.display = "block";
			if (!page._poll) page._poll = window.setInterval(function () { pullJob(); }, 3000);
			importJobsFromHost().then(function () { pullJob(); });
			render();
		}

		/* ---------- sidebar entry ---------- */
		function findSidebarColumn() {
			var all = document.querySelectorAll("div");
			for (var i = 0; i < all.length; i++) {
				var cn = all[i].className;
				if (typeof cn === "string" && cn.indexOf("sidebarCol") !== -1 && all[i].offsetWidth > 0) return all[i];
			}
			return null;
		}

		function findSkillSectionMarker(column) {
			var candidates = column.querySelectorAll("button, a, [role=\"button\"], [role=\"tab\"], [role=\"menuitem\"]");
			var matched = [];
			for (var i = 0; i < candidates.length; i++) {
				var node = candidates[i];
				if (node.hasAttribute("data-dsh-hs2-pipeline")) continue;
				var hay = ((node.textContent || "") + " " + (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || ""));
				if (hay.indexOf("技能中心") !== -1 || hay.indexOf("Skill Center") !== -1) matched.push(node);
			}
			if (matched.length === 0) return null;
			for (var j = 0; j < matched.length; j++) {
				var outer = true;
				for (var k = 0; k < matched.length; k++) {
					if (k !== j && matched[k].contains(matched[j])) { outer = false; break; }
				}
				if (outer) return matched[j];
			}
			return matched[matched.length - 1];
		}

		function adaptEntry(node) {
			node.removeAttribute("id");
			node.removeAttribute("title");
			node.removeAttribute("aria-expanded");
			node.removeAttribute("aria-selected");
			node.removeAttribute("aria-current");
			node.removeAttribute("data-state");
			node.setAttribute("aria-label", "做衣服 mod");
			node.setAttribute("data-dsh-hs2-pipeline", "");
			var svg = node.querySelector("svg");
			if (svg) {
				var box = svg.cloneNode(false);
				box.setAttribute("fill", "none");
				box.setAttribute("stroke", "currentColor");
				box.setAttribute("stroke-width", "1.4");
				box.setAttribute("stroke-linecap", "round");
				box.setAttribute("stroke-linejoin", "round");
				box.setAttribute("viewBox", "0 0 16 16");
				box.setAttribute("aria-hidden", "true");
				if (!box.getAttribute("width")) box.setAttribute("width", "18");
				if (!box.getAttribute("height")) box.setAttribute("height", "18");
				box.innerHTML = "<rect x=\"1.5\" y=\"6\" width=\"3.5\" height=\"4\" rx=\"1\"/><rect x=\"11\" y=\"2\" width=\"3.5\" height=\"4\" rx=\"1\"/><rect x=\"11\" y=\"10\" width=\"3.5\" height=\"4\" rx=\"1\"/><path d=\"M5 8h2.5M7.5 8 11 4M7.5 8 11 12\"/>";
				svg.parentNode.replaceChild(box, svg);
			}
			var textNodes = [];
			var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
			var current;
			while ((current = walker.nextNode()) !== null) {
				if (current.parentElement && current.parentElement.closest("svg")) continue;
				if (current.nodeValue && current.nodeValue.trim() !== "") textNodes.push(current);
			}
			if (textNodes.length > 0) {
				textNodes[0].nodeValue = "做衣服 mod";
				for (var i = 1; i < textNodes.length; i++) textNodes[i].nodeValue = "";
			}
			node.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				openPage();
			});
		}

		function buildFallbackEntry() {
			var button = document.createElement("button");
			button.type = "button";
			button.setAttribute("data-dsh-hs2-pipeline", "");
			button.setAttribute("aria-label", "做衣服 mod");
			button.style.cssText = "box-sizing:border-box;margin:0;align-items:center;min-width:0;display:flex;cursor:pointer;color:var(--dsw-alias-label-secondary);border:none;background:transparent;padding:0;font-family:inherit;font-size:14px;font-weight:400;line-height:24px;text-align:left;width:100%";
			button.textContent = "做衣服 mod";
			button.addEventListener("click", function () { openPage(); });
			return button;
		}

		function placeEntry(column, existing) {
			if (column === null) return existing;
			if (existing !== null && existing.parentNode === column) return existing;
			var marker = findSkillSectionMarker(column);
			if (marker) {
				var node = existing || marker.cloneNode(true);
				if (!existing) adaptEntry(node);
				marker.insertAdjacentElement("afterend", node);
				return node;
			}
			var fallback = existing || buildFallbackEntry();
			column.appendChild(fallback);
			return fallback;
		}

		function mount() {
			ensureStyle();
			load();
			rebuildParts();
			var column = findSidebarColumn();
			entry = placeEntry(column, entry);
			var observer = new MutationObserver(function () {
				window.requestAnimationFrame(function () {
					if (entry && entry.isConnected) return;
					var col = findSidebarColumn();
					if (!col) return;
					entry = placeEntry(col, entry);
				});
			});
			observer.observe(document.body, { childList: true, subtree: true });
			return function () {
				observer.disconnect();
				if (entry && entry.parentNode) entry.parentNode.removeChild(entry);
				if (page && page.parentNode) page.parentNode.removeChild(page);
			};
		}

		function apply(ctx) {
			ctx.effect(function () { return mount(); }, "dsh-hs2-pipeline: flowchart");
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
