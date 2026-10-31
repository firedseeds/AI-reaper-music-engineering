# MUSIC — 项目交接文档

> **给接手的 agent：读完这一份就够了。** 下面包含两首曲子的全部参数、依赖、工作流、命令和坑。
> 如果只记一件事：**REAPER 负责编排和导出分轨，Audacity 负责混音和母带。**

---

## 0. 目录

```
music/
├── README.md              ← 本文件
├── midi-reader.mjs       共用的 MIDI 解析器
├── package.json          @coderline/alphatab
├── house-demo/           5:31 house
└── thrash-metal/         3:23 thrash metal
```

整个文件夹 **40 MB / 100 个文件**。采样包已裁剪到只剩工程实际用到的 3 个文件，原始包（702 个文件、381 MB）不在此目录。

---

## 1. 两首曲子

| | **House** | **Thrash** |
|---|---|---|
| 目录 | `house-demo/` | `thrash-metal/` |
| 工程 | `house-124-fmin.rpp` | `thrash-190-em.rpp` |
| 试听 | `house-124-fmin-preview.mp3` | `thrash-preview.mp3` |
| 时长 | 5:31（331 s） | 3:23（202 s） |
| BPM | 124 | 190 |
| 调性 | F 小调 | E 小调 |
| 小节 | 171 | 160 |
| 轨数 | 13 | 6 |
| MIDI 音符 | 13,916 | 18,001 |

### 曲式

```
House
intro 16 | drop A 32 | break 16 | drop B 32 | jazz 16 | vocal 16 | drop C 32 | outro 11

Thrash
intro 16 | verse 16 | chorus 16 | verse 16 | chorus 16
| bridge 8 | solo 16 | sweep 16 | vocal 16 | chorus 3 16 | outro 8
```

---

## 2. 工作流（两个阶段）

```
① 生成      node make-*.mjs      → MIDI + timeline.json
② 编排      node make-rpp.mjs    → .rpp（媒体用相对路径）
③ 挂载      打开 .rpp → 跑 add-fx.lua → 插件自动挂好
④ 导出分轨  REAPER: Ctrl+A → Render → Selected tracks (stems)
⑤ 混音      Audacity: 导入分轨 → 电平/声像/EQ/压缩/限幅 → 导出
```

**REAPER 工程里的推子和声像都是归零的**（1.0 / 居中），因为混音搬到 Audacity 了。分轨是干净的，不要指望打开工程就直接好听。

### 步骤 ③：插件挂载

`add-fx.lua` 按**轨道名**匹配插件名：

| 轨名含 | 加载 |
|---|---|
| `MT-PowerDrumKit` | MT-PowerDrumKit |
| `Ample LP` | Ample Guitar LP (Ample Sound) |
| `Surge XT` | Surge XT |

脚本会把插件插到 FX 链**第 0 位**（乐器在效果器之前），并自动保存。重复运行安全。

### 步骤 ④：导出分轨

```
File → Render (Ctrl+Alt+R)
Source:  Selected tracks (stems)
Bounds:  Entire project
Format:  WAV 24-bit PCM
```

先 `Ctrl+A` 全选轨道。文件名会带轨名。

**注意**：stems 会经过每轨自己的 FX（如 `muted-eq`），但**不经过主轨 FX**（`build-filter`、`limiter`）。见第 6 节。

---

## 3. 步骤 ⑤：Audacity 混音

### 导入

`File → Import → Audio` → 选中所有 stem 的 WAV。每个文件成为一条轨道。

### 电平与声像（House 13 轨）

| 轨道 | Gain (dB) | Pan |
|---|---|---|
| Drums | 0 | C |
| Bass | -2 | C |
| Vocal (TTS) | -1.5 | C |
| Penta Lead | -5 | +25 |
| Stabs | -6 | +15 |
| Power Chords | -7.5 | L35 |
| Funk Clav | -7 | L45 |
| Jazz Gtr | -5 | L20 |
| Muted Gtr | -6 | R40 |
| Clap | -7 | C |
| Pad | -10.5 | C |
| FX | -6 | C |
| Break | -9 | C |

### 电平与声像（Thrash 6 轨）

| 轨道 | Gain (dB) | Pan |
|---|---|---|
| Drums | -0.5 | C |
| Bass | -2.5 | C |
| Rhythm L | -5 | L75 |
| Rhythm R | -5 | R75 |
| Lead | -4.5 | C |
| Vocal | -1.5 | C |

### 处理链

1. **Filter Curve EQ** — 高通：House 30 Hz、Thrash 40 Hz
2. **Filter Curve EQ** — 人声轨：+4 dB @ 2.8 kHz，-3 dB @ 400 Hz（已预先处理过，可省）
3. **Compressor** — 总线上轻微：threshold -18 dB、ratio 2:1、attack 10 ms、release 100 ms
4. **Limiter** — ceiling **-1 dB**
5. `Tracks → Mix → Mix and Render` 合成单轨
6. `File → Export` → WAV 24-bit 或 MP3 320

### 滤波构建会跟着分轨走

House 的 intro / break 滤波构建（`build-filter.jsfx`）现在挂在**每一条轨的 FX 链末尾**，不是主轨。

因为线性滤波与求和可交换，逐轨滤波再在 Audacity 相加，结果和主轨滤波完全一致——但这样一来 **stems 就自带构建效果**，不需要回 REAPER 重渲。

实测：分轨导出后 intro 的 3kHz 以上能量 -34.6 dB，drop A 是 -26.2 dB，差 8.4 dB。

---

## 3.5 乐谱（Guitar Pro 8）

用 **alphaTab** 的 `Gp7Exporter` 直接写 **.gp**（GP7/8 原生格式，本质是 zip + XML）。GP8 里 `File → Open` 直接打开，不需要导入。

```powershell
cd music
npm install @coderline/alphatab      # 只需一次（node_modules 在 music/ 根目录共享）

cd house-demo  && node make-gp7.mjs  # → house-124-fmin.gp
cd ../thrash-metal && node make-gp7.mjs  # → thrash-190-em.gp
```

| 工程 | 轨 | 音符 | 丢失 |
|---|---|---|---|
| House | Power Chords | 576 | 0 |
| House | Muted Gtr | 1,292 | 0 |
| House | Jazz Gtr | 178 | 10 |
| House | Lead | 498 | 0 |
| House | Bass | 684 | 0 |
| Thrash | Guitar | 6,528 | 3 |
| Thrash | Lead | 512 | 0 |
| Thrash | Bass | 1,312 | 1 |

- 每小节 16 个 16 分音符格；**只读 note-on**，时值由网格决定
- 弦位：最低把位优先，被占用就换一根能弹同一音高的弦（House 爵士轨因此只丢 10 个）
- 闷音轨整轨标记 `palm mute`
- **GP7 格式能装的东西比 GP5 多**：鼓轨、钢琴谱表理论上都可以，但 alphaTab 的模型要求音符带 string + fret，构造纯键盘谱表不划算，合成器部分仍用 MusicXML

### 合成器轨 → 键盘谱（MusicXML）

```powershell
cd music/house-demo
python make-musicxml.py   # → house-124-keys.musicxml
```

| 声部 | 内容 | 音符 |
|---|---|---|
| P1 Stabs | 和弦短音 | 2,215 |
| P2 Clav | Funk 切分 | 3,588 |
| P3 Lead | 五声主旋律 | 498 |

高音谱表，标准记谱，171 小节，**一个音都不丢**（MusicXML 没有弦位限制）。
GP8 导入：`File → Import → MusicXML`。
## 4. 依赖

### 插件（必须）

| 插件 | House | Thrash |
|---|---|---|
| MT-PowerDrumKit | 鼓 | 鼓 |
| Ample Guitar LP | 强力 / 闷音 / 爵士 | 节奏 ×2 + 独奏 / 扫拨 |
| Surge XT | 贝斯、和弦、主旋律、Clav | 贝斯 |

Ample LP 需要**独立的音色库**，只装插件没声音。

### JSFX

复制 `jsfx/*.jsfx` 到 `%APPDATA%\REAPER\Effects\DSH\`。

| 文件 | 用途 | House | Thrash |
|---|---|---|---|
| `muted-eq.jsfx` | 闷音吉他三段 EQ | ✅ | — |
| `build-filter.jsfx` | 主轨滤波构建（按 `beat_position` 自动变化） | ✅ | — |
| `limiter.jsfx` | 主轨限幅（**已不再使用**，限幅交给 Audacity） | — | — |

**缺 JSFX 不报错**，只是效果静默消失——这是最隐蔽的坑。

### 采样

- `house-demo/blu-mar-ten-main/` — **只保留工程引用的 3 个文件**（1.9 MB）：

  | 文件 | 用途 | 引用位置 |
  |---|---|---|
  | `Pads/Wash_Pad_7A.wav` | 八段 pad | Pad 轨 |
  | `FX/Aura_Rise_3A.wav` | 上升音效 | 每个 drop 前 |
  | `FX/Aura_Boom_4A.wav` | 冲击音 | 每个 drop 落点 |

  需要别的采样时要重新下载完整包；RPP 只认这三个路径，文件缺失会在加载时提示。
- `house-demo/clap.wav`、`break-124.wav`、`vox1/2.wav`
- `thrash-metal/vox1~4.wav` — TTS 人声（`*-raw.wav` 是未处理原版）

---

## 5. 重新生成

```powershell
cd music/house-demo
node make-house.mjs      # MIDI + timeline.json
node make-rpp.mjs        # .rpp
node render-preview.mjs  # 合成器试听（近似，非最终音色）

cd ../thrash-metal
node make-thrash.mjs
node make-rpp.mjs
node render-preview.mjs
```

### 可调参数在哪

| 想改 | 位置 |
|---|---|
| BPM | `make-*.mjs` 顶部 `BPM` |
| 段落长度 | `SONG` 数组（`bars` 字段） |
| 和声 | `PROGRESSION`（house）/ `NOTE` + `RIFF_*`（thrash） |
| 旋律 | `LEADS`、`BREAK_LEAD`（house）/ `SOLO`、`SWEEP`（thrash） |
| 鼓型 | `drumBar()`（thrash） |

`make-rpp.mjs` 从 `timeline.json` 读段落位置，所以改完 `make-*.mjs` **必须重跑 `make-rpp.mjs`**，否则采样位置会错位。

---

## 6. 已知限制（重要）

1. **VST 状态写不进 .rpp**。手写 `<VST>` 块缺插件序列化的二进制状态，REAPER 会卡在加载对话框。所以工程只留轨名提示，插件靠 `add-fx.lua` 挂。
2. **试听是合成器近似**。`*-preview.mp3` 由 `render-preview.mjs` 的简易合成器渲染，只用来判断结构和律动；真实音色取决于 Ample LP 的音箱模拟与鼓组采样。
3. **TTS 人声经 ffmpeg 做成嘶吼质感**，本质仍是念白。处理链：

   ```
   rubberband pitch=1.05 formant=1.15   ← 提高音高和共振峰，像更小的声道
   asplit → 一路 acrusher 7bit + asoftclip tanh 0.10  ← 数字碎化 + 重度失真，并联保留可懂度
   highpass 180 → EQ 420Hz -5 → 1.9k +6 → 3.6k +4
   acompressor 6:1 → aexciter → +11dB → alimiter 0.9
   ```

   2–6kHz 能量从 -32.9 dB 提到 **-25.5 dB**（+7.4 dB）；频谱平坦度（噪声化程度）0.155 → 0.208，`acrusher` 贡献了其中的颗粒感。
   原始文件保留为 `vox1-raw.wav` ~ `vox4-raw.wav`。
4. **声像不在试听里**。试听文件是居中混的。
5. **限幅在 Audacity 做**。工程里已经没有 master limiter，导出分轨后不会自动限制峰值。
6. **媒体是相对路径**。整个 `music/` 文件夹可以整体拷走；只拷 `.rpp` 会丢文件。

---

## 7. 换设备

1. 拷整个 `music/` 文件夹
2. 装 3 个插件 + Ample 音色库
3. 拷 `jsfx/*.jsfx` 到 `%APPDATA%\REAPER\Effects\DSH\`
4. 打开 `.rpp` → 跑 `add-fx.lua` → 导出分轨 → Audacity 混音

没有插件时：先在原机器导出 stems（或 Freeze），新机器只需要 REAPER + Audacity。

---

## 8. 文件清单

```
music/
├── README.md
├── house-demo/
│   ├── house-124-fmin.rpp / .mp3
│   ├── house-*.mid              7 条 MIDI（drums/bass/stabs/power/lead/clav/gtr）
│   ├── blu-mar-ten-main/        采样包
│   ├── clap.wav break-124.wav vox1.wav vox2.wav
│   ├── jsfx/                    4 个 JSFX 备份
│   ├── add-fx.lua
│   ├── make-gp7.mjs                 MIDI → .gp 六线谱（alphaTab）
├── house-124-fmin.gp            六线谱（5 轨，GP8 直接打开）
├── make-musicxml.py             MIDI → MusicXML 键盘谱
├── house-124-keys.musicxml      键盘谱（Stabs / Clav / Lead）
├── make-house.mjs  make-rpp.mjs  render-preview.mjs
│   └── check-midi.mjs           MIDI 校验工具（可复用）
└── thrash-metal/
    ├── thrash-190-em.rpp / .mp3 / .wav
    ├── thrash-*.mid             5 条 MIDI（gtr-l/gtr-r/bass/lead/drums）
    ├── vox1~4.wav  vox1~4-raw.wav
    ├── jsfx/limiter.jsfx
    ├── add-fx.lua
    ├── make-gp7.mjs                MIDI → .gp 六线谱（alphaTab）
    ├── thrash-190-em.gp            六线谱（Guitar / Lead / Bass）
    └── make-thrash.mjs  make-rpp.mjs  render-preview.mjs
```










