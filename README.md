# GGSAFE

Google로 로그인하고 본인 이메일과 비밀번호의 공개 유출 기록을 확인하는 한국어 보안 도우미예요. 기존 화면을 재사용하는 Streamlit 버전이에요.

> **현재 상태:** 앱 코드와 합성 데이터 검증은 준비됐어요. 공개 주소의 실제 Google 로그인과 영구 기록 보관 연결은 아직 확인 전이에요. 저장소 업로드가 배포 완료를 뜻하지는 않아요.

## Streamlit Community Cloud 연결

Streamlit에서 **Create app → GitHub 저장소 연결**을 선택하고 다음을 입력해요.

| 항목 | 값 |
|---|---|
| Repository | `hwnam0812/ggsafe` |
| Branch | `feat/streamlit-web` |
| Main file path | `streamlit_app.py` |
| Python | `3.11` 이상, `3.15` 미만 |

첫 업로드 대상 저장소는 비어 있었으며 공개 범위는 변경하지 않았어요. 기존 Windows 앱이나 Google 등록은 수정하지 않았어요.

### 로그인과 기록 보관 설정

1. Streamlit에서 사용할 앱 주소를 정해요. Google OAuth 웹 클라이언트의 승인된 리디렉션 URI에 `https://실제-앱-주소/oauth2callback`을 **추가**해요. 기존 PC·웹 주소는 지우지 않아요.
2. Streamlit 앱의 **Settings → Secrets**에 `.streamlit/secrets.example.toml`의 항목을 등록해요. Google 클라이언트 ID·비밀값, 충분히 긴 무작위 쿠키 비밀값, 실제 돌아올 주소, 영구 보관용 PostgreSQL 연결이 필요해요. 예시 문자열은 실제 값으로 바꿔야 해요.
3. Google 권한은 `openid email`만 사용해요. `expose_tokens`는 추가하지 않아요. 로그인 주소를 PC 내부 주소로 설정하지 않아요.
4. 공개 앱에서는 PostgreSQL을 반드시 연결해요. 연결이 없으면 오류를 안내하며, 사라지는 임시 파일로 조용히 바꿔 저장하지 않아요.
5. 새 창에서 공개 앱을 열고 실제 Google 로그인, 검사 동의, 검사 결과, 로그아웃·재접속, 다른 브라우저의 같은 계정 이력을 확인한 뒤 게시 완료로 판단해요.

실제 Secrets·쿠키·검사 기록·GitHub 토큰은 이 저장소에 포함하지 않아요. `GH_TOKEN`은 코드 업로드 도구에만 필요하고 게시 앱에는 필요하지 않아요.

## 개인정보와 검사

- Streamlit이 확인한 Google 계정만 사용해요. 로그인한 이메일 이외의 검사는 거절해요.
- 로그인은 기본 30일 쿠키를 사용해요. Google 비밀번호·메일함·Drive 권한은 가져오지 않아요.
- 이메일은 별도 동의와 클릭이 있을 때 XposedOrNot에 보내요. 이력 저장은 기본 꺼짐이에요.
- 비밀번호는 브라우저 안에서 변환하고 앞 5글자만 HIBP Pwned Passwords에 보내요. 비밀번호 원문과 전체 해시는 Python 앱에 보내거나 저장하지 않아요.
- 완료한 비밀번호 검사는 시각·결과·발견 횟수만 저장해요. 오류·중단 결과는 저장하지 않아요. 저장만 재시도할 때 외부 검사를 반복하거나 중복 기록을 만들지 않아요.
- 이력은 계정별 최근 30일·최신 100개예요. 유출 기록 미발견은 계정이 안전하다는 보장이 아니에요.

## 개발과 검증

공개 앱은 `streamlit_app.py`를 실행해요. 필요한 Python 패키지는 `requirements.txt`와 `pyproject.toml`에 있어요.

```sh
uv sync
uv run streamlit run streamlit_app.py
uv run pytest
npm ci
npm run build:streamlit
npm test
```

`ggsafe_streamlit/ui`는 Streamlit이 제공하는 필수 화면 패키지예요. 화면 소스를 수정할 때만 `npm run build:streamlit`으로 다시 만들어요. Community Cloud에서 Node 빌드를 실행할 필요는 없어요. 일반 웹 빌드 산출물·개인 기록·개발 환경은 포함하지 않아요.

`npm run dev`는 로컬 미리보기 전용 실행기예요. 기록은 명시적으로 별도 로컬 보관을 사용하며 공개 앱의 기록과 공유하지 않아요. Google 연결을 시험하려면 `GGSAFE_STREAMLIT_REDIRECT_URI`에 실제 등록된 주소가 필요해요. 비밀값은 환경 변수 또는 로컬 Secrets로만 전달해요.

원래 웹 버전의 실행은 `npm run dev:web`로 보존했어요. 기존 웹의 72시간 로그인 규칙과 기록은 새 Streamlit 버전의 30일 로그인·기록과 별개예요.

### 확인한 범위

Python 테스트 93개와 기존 웹 테스트 179개, TypeScript 검사 및 화면 패키지 빌드가 통과했어요. `tests_streamlit`의 브라우저 검사는 합성 쿠키·응답으로 1440·558·383px의 검사·검색·목록 이동·저장·재시도·계정 분리·삭제·로그아웃을 확인했어요. 만료·위조 쿠키·다른 탭 로그아웃과 진행 중 조회 중단도 확인했어요.

합성 로그인 검사는 실제 Google 로그인 성공을 의미하지 않아요. 실제 사용자 이메일이나 비밀번호로 외부 검사를 실행하지 않았어요. 공개 PostgreSQL 연결과 공개 주소의 Google 로그인은 별도 확인이 필요해요.

설정 참고: [Streamlit 사용자 로그인](https://docs.streamlit.io/develop/concepts/connections/authentication), [Community Cloud 배포](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app).
