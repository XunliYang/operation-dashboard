"""collector 测试引导：跨包复用 api 的 org_classifier。

collector 与 api 是 monorepo 中两个独立部署单元，但 email 哈希/脱敏与组织
分类优先级逻辑的 canonical 实现都在 `api/app/services/org_classifier.py`（纯
函数模块，仅依赖 stdlib + PyYAML）。collector 侧直接 import 该模块以避免逻辑
分叉；本文件把 `api/` 目录加入 sys.path，使 `import app` 在测试进程可用。

生产镜像通过 Dockerfile `COPY api/app ./app` 提供同样能力（WORKDIR 在 sys.path）。
"""

from __future__ import annotations

import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[1] / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))
