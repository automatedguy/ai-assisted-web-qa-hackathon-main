export type QaIssue = {
  id: string;
  category:
    | "spelling_grammar"
    | "formatting"
    | "links"
    | "locale_rules"
    | "brand_voice"
    | "translation_quality"
    | "terminology"
    | "media";
  severity: "critical" | "major" | "minor" | "suggestion";
  location: {
    page_url: string;
    selector_or_xpath?: string;
    element_type: "text" | "image" | "video" | "link";
  };
  visual_evidence?: {
    screenshot_url: string;
    highlighted: boolean;
    note?: string;
  };
  description: string;
  assessment?: {
    method: "deterministic" | "model_text" | "model_visual";
    rule?: { id: string; value: string };
  };
  evidence: string;
  expected?: string;
  confidence: number;
  suggested_fix?: string;
  status: "new" | "verified" | "dismissed" | "escalated";
};


export const categories: QaIssue["category"][] = [
  "spelling_grammar", "formatting", "links", "locale_rules", "brand_voice",
  "translation_quality", "terminology", "media",
];
