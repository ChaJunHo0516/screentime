"""FocusFlow 서버 API 클라이언트 (PHASE 1).

* 모든 요청에 Authorization: Bearer <agent token> 을 붙인다.
* 사용자 ID 는 서버가 토큰으로 결정한다 → agent 는 더 이상 user_id 를 보내지 않는다.
* 401 을 받으면 AuthError 를 던진다 (토큰 만료/폐기 → 재로그인 필요).
* 토큰 값은 절대 출력하지 않는다.

PHASE 3 에서 ActivityBuffer / 오프라인 큐가 이 클라이언트를 사용해 batch 업로드를 수행한다.
"""
import platform

import requests


class AuthError(Exception):
    """인증 실패(401). 다시 로그인해야 한다."""


class ApiError(Exception):
    """서버가 오류 응답을 반환했거나 연결할 수 없음."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class ApiClient:
    def __init__(self, base_url, token=None, timeout=3, session=None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.session = session or requests.Session()

    def _headers(self):
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def request(self, method, path, *, json=None, params=None, timeout=None):
        url = f"{self.base_url}{path}"
        try:
            res = self.session.request(
                method,
                url,
                json=json,
                params=params,
                headers=self._headers(),
                timeout=timeout or self.timeout,
            )
        except requests.RequestException as exc:
            raise ApiError(f"서버 연결 실패: {exc.__class__.__name__}") from exc
        if res.status_code == 401:
            raise AuthError("인증이 만료되었거나 유효하지 않습니다. `python tracker.py --login` 으로 다시 로그인하세요.")
        return res

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def get_json(self, path, **kwargs):
        res = self.get(path, **kwargs)
        if res.status_code != 200:
            raise ApiError(f"GET {path} 실패", res.status_code)
        return res.json()

    def me(self):
        """현재 토큰의 사용자 정보 {user_id, username}."""
        return self.get_json("/api/auth/me").get("user_info", {})

    @staticmethod
    def login(base_url, user_id, password, timeout=5, session=None):
        """아이디/비밀번호로 agent 토큰을 발급받는다. 성공 시 (token, user_info) 반환."""
        client = ApiClient(base_url, timeout=timeout, session=session)
        try:
            res = client.session.post(
                f"{client.base_url}/api/auth/login",
                json={
                    "user_id": user_id,
                    "password": password,
                    "client": "agent",
                    "device_name": platform.node()[:100],
                },
                timeout=timeout,
            )
        except requests.RequestException as exc:
            raise ApiError(f"서버 연결 실패: {exc.__class__.__name__}") from exc
        data = {}
        try:
            data = res.json()
        except ValueError:
            pass
        if res.status_code != 200 or not data.get("token"):
            raise ApiError(data.get("message") or f"로그인 실패 ({res.status_code})", res.status_code)
        return data["token"], data.get("user_info", {})

    def logout(self):
        try:
            self.post("/api/auth/logout")
        except (ApiError, AuthError):
            pass
