# 8차 UI + 엔진 v0.4 운영 배포 (2026-10-19)

사용자가 UI 배포에 이어 **반경 선택용 v0.4도 포함**하도록 명시적으로 요청했다. 이전 Docker·Cloud Run 변경 보류는 이번 배포에 필요한 범위에서 해제된 것으로 적용했다. 제품 코드는 수정하지 않았다.

## 배포 대상과 결과

- 소스: `10202001ebfe1e4ad16d5c7c392e065648dc3d48` (`1020200`). 커밋된 파일만 별도 컨텍스트로 추출했다. 로컬 `.env`는 컨텍스트에 넣지 않고 지도 공개 Client ID·Style ID만 기존 build arg로 전달했다.
- registry index digest: `sha256:3127332eba463bbd9b79b92068c5c4f80b4d9041ea20247812e807c1c8c68196`.
- 실제 linux/amd64 manifest: `sha256:8c36ba1235f15a1de18ccb9b7cfd92b0038f61a6f9af8b215086798716c52e9b`. Cloud Run `status.imageDigest`와 일치한다. 이미지 revision label도 소스 커밋과 일치한다.
- 운영 리비전: `<서비스>-1020200-v04`, 트래픽 **100%**. 임시 검증 태그는 제거했다. 이전 `<서비스>-6f7df52` 리비전과 이미지는 복구용으로 보존했다.
- `SCORING_ENGINE_VERSION=v0_4`. `/health`는 `mvp-0.4`, `[300,500,1000]`, 기본 500m를 광고한다. warm **87/87, done=true, failed=false** 확인 후 트래픽을 전환했다.
- 기존 자원 설정 유지: 서울 리전, 1 vCPU·1Gi, min/max instances 1/1, concurrency 4, CPU 항상 할당, startup CPU boost, timeout 300초, uvicorn worker 1. IAM은 변경하지 않았다.

## 배포 전후 직접 검증 (Codex)

기존 최종 전체 check(Claude, 303/61/133/646건)를 재사용했고, 변경 없는 제품 코드의 전체 테스트는 반복하지 않았다. 이번에는 실제 이미지·서버·운영 화면을 검증했다.

1. Docker Desktop을 시작하고 해당 커밋의 Linux 이미지를 빌드·업로드했다. Windows tar의 한글 경로 추출 실패는 별도 ZIP 컨텍스트로 다시 추출해 해결했다. 실패한 컨텍스트는 빌드에 사용하지 않았다.
2. 별도 Linux 컨테이너를 `--cpus 1 --memory 1g --memory-swap 1g`로 실행했다. cgroup `cpu.max=100000 100000`, memory limit 1,073,741,824 bytes. warm 87개 완료, 메모리 최고 **244,764,672 bytes(233.4MiB)**, OOM 및 OOM kill 0, `OOMKilled=false`. 측정 후 이 검증 컨테이너만 종료·제거했다.
3. Cloud Run에 digest 지정·무트래픽·검증 태그로 배포했다. Ready/ContainerHealthy 확인, 실제 환경 1 vCPU·1Gi 확인, warm 87개 완료 후 전환했다. 관측 시작이 이미 일부 warm된 뒤이므로 아래 시간을 전체 warm 시간으로 해석하지 않는다.
4. 반경별 `/analyze`·`/nearby-stores`: 부평역 PC방 **300m 6곳 / 500m 12곳 / 1km 17곳**, 분석 raw의 동종점포수와 목록 길이가 일치했다. 종합 점수는 각각 66.9 / 65.8 / 69.0이다. 기존 운영 v0.3과 500m 전체 응답을 대조해 엔진 버전 외 동일함을 확인했다(숫자 허용오차 1e-9).
5. Cloud Run에서 warm 중 아직 계산되지 않은 1km 요청 1건 5.282초, warm 후 분석 3건 0.125~0.141초(클라이언트에서 측정). 단일 관측이며 지연 상한·p95·동시 부하 결과가 아니다. 컨테이너의 warm 중 요청 1건은 2.391초였다.
6. Cloud Monitoring에서 새 리비전 메모리 사용률 관측 샘플 약 28.2~29.5%. 최고 순간 메모리나 장시간 부하 결과로 주장하지 않는다. 초기 빈 지표는 0으로 해석하지 않았다. 배포 후 조회한 새 리비전 severity ERROR 이상 로그는 0건이다.
7. 정적 파일·API 확인: `/`, `/health`, `/businesses` 200, JS/CSS immutable 캐시, GeoJSON SHA-256 원본 일치, `/docs`·`/redoc`·`/openapi.json`·없는 asset 404, GET `/analyze` 405, 지원하지 않는 반경 422 `invalid_radius`. 초기 smoke 검사기의 HTTP 헤더 대소문자 처리를 고친 후 재검증했다(제품 결함이 아님).
8. NAVER에 등록된 운영 주소에서 실제 GPU 다크 지도(`data-map-tone=dark`), 단일 분석, 1km 전환, A/B 비교와 비교 중 300m 전환, 모바일 첫 진입·좌표 입력·분석·지도 전환을 확인했다. 1024×800 및 375×812, 가로 넘침 없음, 브라우저 콘솔 error 0건. 실제 모바일 기기·Safari·Firefox·스크린리더는 미검증이다.

## 남은 사항

- **작은 UI 차이**: 모바일 결과 지도 시트에서 헤드라인은 숨겨지지만 참고 주소는 한 줄 남아 있다. 원본 CSS의 `.map-sheet:has(.map-sheet__score) .reference-address` 숨김 선택자가 실제 압축 번들에는 없고, 운영 DOM의 해당 주소는 `display:block`임을 확인했다. 정확한 빌드 변환 원인은 미확정이다. 분석 전 주소 유지·결과 주소 숨김을 **production build 브라우저에서** 검증하는 후속 수정이 필요하다. 이번 배포에서는 승인된 커밋을 그대로 유지했다.
- 컨테이너·Cloud Run 검증은 각 1회이며 8-D2c 계획의 반복·동시 부하 성능 연구 전체를 완료한 것은 아니다. 최적화 완료나 지연 상한을 주장하지 않는다.
- 이번 전환은 warm 완료 후 진행했다. 향후 인스턴스 재시작 시에는 미warm 키의 초기 요청 지연이 다시 생길 수 있다. 기존에 열어 둔 구버전 UI는 새로고침이 필요할 수 있다.

## 복구

`gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-6f7df52=100`

복구 후 이전 엔진·화면과 `/health` warm 29/29 완료를 확인한다. 트래픽 없는 이전 리비전은 다시 시작해야 할 수 있다. 이번 배포에서 복구 전환은 실행하지 않았다.

원본 로그·리비전 설정·검증 JSON·캡처는 git 제외 `.gstack/deploy-1020200/`에 있다. 서비스 URL·프로젝트 이름·지도 설정 값은 저장소에 기록하지 않는다. 배포 후 수정한 파일은 배포 기록 문서뿐이며 별도 커밋하지 않았다.
