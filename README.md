# ARENA FPS

three.js 기반 웨이브 서바이벌 슈터 프로토타입. Vibe-coded with Claude.

- **플레이**: https://parksw20.github.io/FPS/
- 1인칭 / 3인칭 숄더뷰, PC(WASD·Shift 대쉬·Space 점프·좌클릭 사격·우클릭 줌·R 재장전·F 수류탄) / 모바일(가상 조이스틱+버튼)
- 웨이브: 러너(3+) · 점퍼(6+) · 원거리(9+) · 보스(10웨이브마다, 광역 점프 공격)
- 아이템: 포션 10% · 보물상자(무한탄약) 5% · 수류탄 5% · 코인 100%
- 코인 상점: 대미지/연사/재장전/탄창/HP 업그레이드, 수류탄 구매(최대 5)
- TOP 10 랭킹(localStorage), 콤보 배율 점수

## 로컬 실행

```bash
node server.mjs 8090
```

http://localhost:8090 (로컬에서는 옵션 메뉴에 디버그 버튼이 추가로 표시됩니다)
