# dora 文档 · 非官方中文翻译

在线阅读：<https://dora-rs.ai/dora/> 的中文版 → **<https://dora.kiloong.com>**

- `zh/`：中文译文；`en/`：英文对照。每页右下角的悬浮按钮可切换语言（保持阅读位置）或打开官方原文。
- 译自 <https://dora-rs.ai/dora/>；原文 © dora-rs contributors，依 [Apache License 2.0](LICENSE) 发布。修改说明见 [NOTICE](NOTICE)。
- 本项目与 dora-rs 项目无关，内容以[官方原文](https://dora-rs.ai/dora/)为准。

## 维护

本仓库内容由翻译工程（`~/wuql_ws/academy_ws/dora_rs_translate`）的 `scripts/publish.py --target github` 生成，请勿手改页面：

```bash
cd ~/wuql_ws/academy_ws/dora_rs_translate
python3 scripts/rebuild.py && python3 scripts/build_search.py
python3 scripts/publish.py --out ~/wuql_ws/dora-docs-zh
cd ~/wuql_ws/dora-docs-zh && git add -A && git commit -m "Update docs" && git push
```

推送到 `main` 后，`.github/workflows/pages.yml` 把仓库静态文件直接发布到 GitHub Pages（无构建步骤），`CNAME` 绑定自定义域名。
