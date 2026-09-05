import { CandidateEditor, type CandidateDraft } from "./candidate-editor.js";
export function CollectionCandidate({
  draft,
  index,
  onChange,
}: {
  draft: CandidateDraft;
  index: number;
  onChange(draft: CandidateDraft): void;
}) {
  const content = draft.candidate.payload;
  const text = content.type === "expression" ? content.text : content.template;
  const meaning = content.type === "expression" ? content.meaningZh : content.functionZh;
  return (
    <article className="collection-candidate">
      <label className="collection-candidate-choice">
        <input
          type="checkbox"
          data-candidate-selected
          checked={draft.selected}
          onChange={(event) => onChange({ ...draft, selected: event.currentTarget.checked })}
        />
        <span>
          <strong>{text}</strong>
          <small>{meaning}</small>
        </span>
      </label>
      <details>
        <summary>编辑内容与标签</summary>
        <CandidateEditor draft={draft} index={index} onChange={onChange} />
      </details>
    </article>
  );
}
