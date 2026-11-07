import fixture from "../../fixtures/suggestion.json";

export type Suggestion = {
  title: string;
  detail: string;
  reason: string;
  source: string;
  kind: string;
};

export function suggestionFromFixture(): Suggestion {
  const suggestion = fixture.payload.suggestion;
  return {
    title: suggestion.title,
    detail: suggestion.detail,
    reason: suggestion.reason,
    source: suggestion.source,
    kind: suggestion.kind,
  };
}
