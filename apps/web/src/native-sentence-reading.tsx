import "./native-sentence-reading.css";
import type {
  StructuredSentenceUnit,
  SentenceStructure,
  AnalysisRecordRead,
} from "@huayi/cloud-contracts";
import { DeepAnalysisTeaching } from "./deep-analysis-teaching.js";

type Sentence = Extract<
  AnalysisRecordRead["result"],
  { type: "sentence-passage-analysis-v3" }
>["sentences"][number];
type ReadingUnit = StructuredSentenceUnit &
  Partial<Pick<Sentence, "translationZh" | "grammar" | "expressions" | "languageNotes">>;
const relations: Record<SentenceStructure["modifiers"][number]["relation"], string> = {
  "relative-clause": "定语从句",
  adverbial: "状语",
  apposition: "同位说明",
  parenthetical: "插入说明",
  complement: "补充说明",
  coordination: "并列",
  other: "修饰说明",
};
function Fragments({
  fragments,
  core = false,
}: {
  fragments: SentenceStructure["coreClauses"][number]["fragments"];
  core?: boolean;
}) {
  return (
    <div className="teaching-fragments" lang="en">
      {fragments.map((fragment) => (
        <span key={`${fragment.start}-${fragment.end}`} data-core-fragment={core || undefined}>
          {fragment.text}
        </span>
      ))}
    </div>
  );
}
export function NativeSentenceReading({ units }: { units: readonly ReadingUnit[] }) {
  return (
    <section className="native-sentence-reading" aria-label="逐句解析">
      <h3>逐句解析</h3>
      {units.map((unit) => (
        <article
          className="native-teaching-unit"
          data-native-unit={unit.analysisUnitId}
          key={`${unit.analysisUnitId}:${unit.sourceText}`}
        >
          <header>
            <span className="analysis-reading-number">
              {String(unit.ordinal + 1).padStart(2, "0")}
            </span>
            <p className="analysis-reading-source" lang="en">
              {unit.sourceText}
            </p>
          </header>
          {unit.translationZh && (
            <p className="analysis-reading-sentence-translation">{unit.translationZh}</p>
          )}
          <section
            aria-label={unit.sentenceStructure.kind === "fragment" ? "片段结构" : "句子主干"}
          >
            <h4>{unit.sentenceStructure.kind === "fragment" ? "片段结构" : "句子主干"}</h4>
            {unit.sentenceStructure.coreClauses.map((core, index) => (
              <div className="teaching-core" key={index}>
                <h5>主干 {index + 1}</h5>
                <Fragments fragments={core.fragments} core />
                <p>{core.explanationZh}</p>
              </div>
            ))}
          </section>
          {unit.sentenceStructure.modifiers.length > 0 && (
            <details data-structure-modifiers>
              <summary>修饰与补充（{unit.sentenceStructure.modifiers.length}）</summary>
              {unit.sentenceStructure.modifiers.map((modifier, index) => (
                <section className="teaching-modifier" key={index}>
                  <h5>
                    修饰项 {index + 1} · {relations[modifier.relation]} · 修饰
                    {modifier.target.kind === "core" ? "主干" : "修饰项"}{" "}
                    {modifier.target.index + 1}
                  </h5>
                  <Fragments fragments={modifier.fragments} />
                  <p>{modifier.explanationZh}</p>
                </section>
              ))}
            </details>
          )}
          {unit.grammar && (
            <DeepAnalysisTeaching title="语法" points={unit.grammar} sourceText={unit.sourceText} />
          )}
          {unit.expressions && (
            <DeepAnalysisTeaching
              title="表达"
              points={unit.expressions}
              sourceText={unit.sourceText}
            />
          )}
          {unit.languageNotes && (
            <DeepAnalysisTeaching
              title="使用提醒"
              points={unit.languageNotes}
              sourceText={unit.sourceText}
            />
          )}
        </article>
      ))}
    </section>
  );
}
