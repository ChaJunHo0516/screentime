"""Agent 인증 토큰 저장소 (PHASE 1).

토큰은 Windows 자격 증명 관리자(Credential Manager)에 저장한다 (`keyring` 라이브러리).
  * config.json 이나 일반 파일에 평문으로 저장하지 않는다.
  * 서버 주소별로 따로 저장한다 (로컬 서버 / Cloud Run 서버 토큰이 섞이지 않도록).

테스트/CI 용도로 환경변수 FOCUSFLOW_AGENT_TOKEN 이 있으면 그것을 우선 사용한다.
"""
import os

SERVICE_NAME = "FocusFlow Agent"
ENV_TOKEN = "FOCUSFLOW_AGENT_TOKEN"


class TokenStoreError(Exception):
    pass


def _keyring():
    try:
        import keyring  # noqa: WPS433 (지연 import: 설치되지 않은 환경에서도 모듈 로드는 가능)
        return keyring
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise TokenStoreError(
            "keyring 패키지가 필요합니다. `pip install -r requirements.txt` 를 실행하세요."
        ) from exc


def _account(base_url):
    return f"token@{base_url.rstrip('/')}"


def load_token(base_url):
    """저장된 토큰을 반환한다. 없으면 None."""
    env_token = os.environ.get(ENV_TOKEN)
    if env_token:
        return env_token.strip()
    try:
        return _keyring().get_password(SERVICE_NAME, _account(base_url))
    except TokenStoreError:
        return None


def save_token(base_url, token):
    _keyring().set_password(SERVICE_NAME, _account(base_url), token)


def delete_token(base_url):
    try:
        _keyring().delete_password(SERVICE_NAME, _account(base_url))
    except TokenStoreError:
        raise
    except Exception:
        # 저장된 토큰이 없는 경우 등 — 무시
        pass
