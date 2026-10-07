export type Clip = {
  id: string;
  title: string;
  caption: string;
  from: string;
  to: string;
};

/** 실제 영상 대신 쓰는 원본 문구. YouTube 콘텐츠가 아니다. */
export const CLIPS: Clip[] = [
  {
    id: "signal",
    title: "신호등 앞에서",
    caption: "파란불이 오기 전에, 엄지가 한 번 더 올라간다.",
    from: "#3d4a3c",
    to: "#171512",
  },
  {
    id: "kettle",
    title: "물 끓는 소리",
    caption: "주전자가 울릴 때까지, 화면은 이미 세 개를 넘겼다.",
    from: "#6a5344",
    to: "#241910",
  },
  {
    id: "window",
    title: "창가의 2초",
    caption: "버스가 멈춘 사이, 밖은 그대로고 피드만 바뀐다.",
    from: "#3e5360",
    to: "#14181c",
  },
  {
    id: "desk",
    title: "덮어 둔 노트",
    caption: "한 줄만 쓰려고 앉았는데, 쇼츠가 먼저 열렸다.",
    from: "#5c4638",
    to: "#1c1612",
  },
  {
    id: "night",
    title: "불 끄기 전",
    caption: "다섯 개만 보자고 한 게, 열두 개째다.",
    from: "#3a3450",
    to: "#14131a",
  },
  {
    id: "bowl",
    title: "식기 전의 한 입",
    caption: "숟가락을 든 손이, 어느새 폰을 집는다.",
    from: "#6b4a32",
    to: "#22180f",
  },
  {
    id: "rain",
    title: "유리창의 비",
    caption: "밖이 젖는 동안, 눈은 다음 영상만 찾는다.",
    from: "#2f4652",
    to: "#101418",
  },
  {
    id: "shoes",
    title: "현관의 신발",
    caption: "나가려다 말고, 신발을 신은 채로 스크롤한다.",
    from: "#4a4036",
    to: "#181410",
  },
];
