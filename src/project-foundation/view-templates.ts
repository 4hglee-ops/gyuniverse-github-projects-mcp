import { DESIRED_VIEWS } from "./operating-foundation.js";
import type { ViewLayout } from "../github/project-views.js";

export interface ViewTemplateSpec {
  name: string; layout: ViewLayout; filter?: string; visibleFields: readonly string[];
  groupBy?: string; verticalGroupBy?: string; sortBy?: readonly [string, "asc" | "desc"][];
  requiredOptions?: Record<string, readonly string[]>; manual?: readonly string[];
}
export const VIEW_TEMPLATES: Record<"operating-v1" | "wbs-v1", readonly ViewTemplateSpec[]> = {
  "operating-v1": DESIRED_VIEWS.map((v): ViewTemplateSpec => ({
    name: v.name, layout: v.layout, filter: v.filter, visibleFields: v.visibleFields,
    groupBy: v.groupBy, verticalGroupBy: v.verticalGroupBy,
    requiredOptions: v.filter?.includes("status:") ? { Status: ["Backlog", "Todo", "In Progress", "In Review", "Done"] } : {},
  })),
  "wbs-v1": [
    { name: "전체 WBS", layout: "table", visibleFields: ["Title", "Status", "Priority", "Part", "Assignees", "Start date", "Target date", "Effort", "WBS Code", "Target"], sortBy: [["WBS Code", "asc"]],
      manual: ["GitHub UI에서 Parent issue 열의 지원·표시를 확인하세요. 이 단계에서는 해당 열의 자동 배치를 검증하지 않았습니다."] },
    { name: "진행 Board", layout: "board", visibleFields: ["Title", "Status", "Priority", "Part", "Assignees"], verticalGroupBy: "Status", requiredOptions: { Status: ["Backlog"] } },
    { name: "파트별 업무", layout: "table", visibleFields: ["Title", "Part", "Status", "Assignees", "Target date"], groupBy: "Part" },
    { name: "내 작업", layout: "table", filter: "assignee:@me -status:Done", visibleFields: ["Title", "Status", "Assignees", "Priority", "Target date"], requiredOptions: { Status: ["Done"] } },
    { name: "주요 마감", layout: "table", filter: "priority:P0 -status:Done", visibleFields: ["Title", "Status", "Priority", "Assignees", "Target date"], sortBy: [["Target date", "asc"]], requiredOptions: { Status: ["Done"], Priority: ["P0"] } },
    { name: "일정 Roadmap", layout: "roadmap", visibleFields: [], manual: ["GitHub UI에서 Start date·Target date 필드, 마커와 확대 수준을 확인하세요. 날짜 배치는 API로 검증하지 않았습니다."] },
  ],
};
export type ViewTemplateName = keyof typeof VIEW_TEMPLATES;
