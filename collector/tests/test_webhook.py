"""Webhook：X-Hub-Signature-256 校验 + X-GitHub-Delivery 幂等去重。"""

import hashlib
import hmac

from collector.github.webhook import DeliveryDedup, verify_signature


def _sign(payload: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def test_verify_signature_accepts_valid():
    assert verify_signature(b'{"hello":"world"}', _sign(b'{"hello":"world"}', "s3cret"), "s3cret") is True


def test_verify_signature_rejects_wrong_secret():
    assert verify_signature(b"x", _sign(b"x", "right"), "wrong") is False


def test_verify_signature_rejects_wrong_payload():
    assert verify_signature(b"tampered", _sign(b"original", "s"), "s") is False


def test_verify_signature_rejects_missing_secret_or_header():
    assert verify_signature(b"x", _sign(b"x", "s"), "") is False
    assert verify_signature(b"x", "", "s") is False
    assert verify_signature(b"x", None, "s") is False


def test_verify_signature_rejects_bad_prefix():
    assert verify_signature(b"x", "sha1=deadbeef", "s") is False


def test_delivery_dedup_marks_repeat_as_seen():
    d = DeliveryDedup()
    assert d.seen("delivery-1") is False
    assert d.seen("delivery-1") is True
    assert d.seen("delivery-2") is False


def test_delivery_dedup_ignores_missing_id():
    d = DeliveryDedup()
    assert d.seen(None) is False
    assert d.seen("") is False