"""Webhook 安全：`X-Hub-Signature-256` 校验 + `X-GitHub-Delivery` 幂等去重。"""

from __future__ import annotations

import hashlib
import hmac
import time


def verify_signature(payload: bytes, signature_header: str | None, secret: str) -> bool:
    """校验 HMAC-SHA256 签名，头格式 `sha256=<hex>`。

    - secret 为空或头缺失/格式错误 → False（fail closed）。
    - 用 `hmac.compare_digest` 防时序侧信道。
    """
    if not secret or not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    supplied = signature_header[len("sha256="):]
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, f"sha256={supplied}")


class DeliveryDedup:
    """按 `X-GitHub-Delivery` 幂等去重：Redis SETNX，不可用时降级为进程内 TTL 集合。

    `seen(id)` 首次返回 False（并登记），重复投递返回 True。
    """

    def __init__(self, redis_client=None, *, ttl_seconds: int = 3600) -> None:
        self._redis = redis_client
        self._ttl = ttl_seconds
        self._prefix = "od:webhook:delivery:"
        self._local: dict[str, float] = {}

    def seen(self, delivery_id: str | None) -> bool:
        if not delivery_id:
            return False
        if self._redis is not None:
            key = f"{self._prefix}{delivery_id}"
            return not bool(self._redis.set(key, "1", nx=True, ex=self._ttl))
        now = time.time()
        self._local = {k: v for k, v in self._local.items() if v > now}
        if delivery_id in self._local:
            return True
        self._local[delivery_id] = now + self._ttl
        return False