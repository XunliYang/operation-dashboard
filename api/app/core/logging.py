"""loguru 日志初始化：控制台输出 + request_id 注入。"""

import sys

from loguru import logger

_CONFIGURED = False

_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{extra[request_id]}</cyan> | "
    "<level>{message}</level>"
)


def setup_logging(level: str = "INFO") -> None:
    """幂等地配置全局 logger。"""
    global _CONFIGURED
    if _CONFIGURED:
        return

    logger.remove()
    logger.configure(extra={"request_id": "-"})
    logger.add(sys.stderr, level=level, format=_FORMAT, backtrace=False, diagnose=False)
    _CONFIGURED = True


def bind_request_id(request_id: str):
    """返回绑定了 request_id 的 logger 上下文。"""
    return logger.bind(request_id=request_id)
