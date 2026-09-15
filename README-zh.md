# ComfyUI 提示词标签编辑器（Prompt Tag Editor）

[English](./README.md) | [中文](./README-zh.md)

ComfyUI 交互式提示词/标签编辑节点，可选本地翻译功能，由腾讯 **Hy-MT2-1.8B**（GGUF，llama.cpp 运行）驱动。

基于新版 `comfy_api.latest` / `ComfyExtension`（V3）节点 API 构建，需要较新版本的 ComfyUI。

## 功能特性

- 提示词输入框与标签 chips 双向同步（逗号分隔）
- 悬停标签弹出控制框：直接调整**权重**、**删除**，无需手动改文本
- **双击** chip 编辑标签文本
- **长按拖动**（350 ms）调整标签顺序
- 翻译结果标签 chips，按语言缓存；未翻译项显示为虚线样式
- **自动翻译**开关：编辑后自动补全缺失的翻译
- 8 种目标语言：中文 / 日语 / 韩语 / 英语 / 法语 / 德语 / 西班牙语 / 俄语
- 懒加载 `Hy-MT2-1.8B-Q4_K_M` GGUF，完整 GPU offload（`n_gpu_layers=-1`），批量翻译请求 + 逐条回退 + 翻译缓存

### 输出

| 输出 | 内容 |
|---|---|
| `Prompt` | 带权重的序列化提示词，如 `(white dress:1.2), long hair` |
| `Translated Prompt` | 逗号分隔的翻译结果 |
| `Tags JSON` | 完整标签列表（text / translation / weight）的 JSON |

## 安装

### 通过 ComfyUI-Manager（推荐）

自定义节点管理器 → 搜索 **Prompt Tag Editor** → 安装。

### 手动安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/kkmlimingfeng/Comfyui_Prompt_Tag_Editor
```

重启 ComfyUI。

### 翻译模型

不装模型节点也能正常用，只有翻译按钮需要模型。

首次使用时会自动下载 `Hy-MT2-1.8B-Q4_K_M.gguf`（约 1.1 GB）到
`ComfyUI/models/text_translation/Hy-MT2-1.8B-GGUF/` —— 主源为 Hugging Face，
失败自动切换 hf-mirror.com。下载期间编辑器状态栏会显示进度。

手动放置也可以 —— 把 GGUF 放到下面目录即可（任意 `*.gguf` 均可识别，推荐 `Q4_K_M`）：

```
ComfyUI/
  models/
    text_translation/
      Hy-MT2-1.8B-GGUF/
        Hy-MT2-1.8B-Q4_K_M.gguf
```

- Hugging Face：<https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF>
- 国内镜像：<https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF>

`requirements.txt` 故意不声明硬依赖：`llama-cpp-python` 是懒加载的，不装它编辑器也能用。

GPU offload 需要 CUDA 版 `llama-cpp-python`。推荐到
<https://github.com/JamePeng/llama-cpp-python/releases>
下载与自己 CUDA 版本（cu124 / cu128 / ...）和 Python 版本（cp310 / cp311 / cp312 / ...）
匹配的预编译 wheel，然后：

```bash
pip install llama_cpp_python-<版本号>+cu128-cp312-cp312-win_amd64.whl
```

其他方式：

```bash
# 通过官方 wheel 索引安装 CUDA 版
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu128

# CPU 版（哪儿都能装，就是慢）
pip install llama-cpp-python
```

## 使用方法

1. 从 **Prompt Tools → Prompt Tag Editor** 添加节点（或直接在输入框里粘贴提示词）。
2. 以 chip 形式编辑标签；在输入框里输入即可新增标签。
3. 悬停 chip → 弹窗显示标题 / 权重 / 删除。
4. 打开**自动**开关可在编辑后自动翻译，或点击 **↻** 按钮手动翻译。
5. 将输出连接到下游节点。

## 许可证

[MIT](LICENSE)
