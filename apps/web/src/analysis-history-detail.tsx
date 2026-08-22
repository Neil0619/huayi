import type { AnalysisRecord } from "@huayi/cloud-contracts";

type PassageResult = Extract<
  AnalysisRecord["result"],
  { readonly type: "sentence-passage-analysis-v2" }
>;
type TeachingPoint = PassageResult["sentences"][number]["grammar"][number];

const selectionLabels = {
  passage: "段落",
  phrase: "短语",
  sentence: "句子",
} as const;

const sourceLabels = {
  manual: "手动输入",
  "study-capture": "学习采集",
} as const;

const registerLabels: Readonly<Record<string, string>> = {
  formal: "正式",
  informal: "非正式",
  literary: "书面／文学",
  neutral: "中性",
  spoken: "口语",
};

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function TeachingPoints({
  points,
  title,
}: {
  readonly points: readonly TeachingPoint[];
  readonly title: string;
}) {
  return (
    <section>
      <h5>{title}</h5>
      {points.length === 0 ? (
        <p>暂无。</p>
      ) : (
        <ol>
          {points.map((point, index) => (
            <li key={`${point.label}-${index}`}>
              <strong>{point.label}</strong>
              {point.evidenceText !== undefined && <p>原文依据：{point.evidenceText}</p>}
              <p>{point.explanationZh}</p>
              {point.commonMistakeZh !== undefined && <p>常见误区：{point.commonMistakeZh}</p>}
              {point.generatedExample !== undefined && (
                <div>
                  <p>例句：{point.generatedExample.sourceText}</p>
                  <p>译文：{point.generatedExample.translationZh}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PhraseResult({
  result,
}: {
  readonly result: Extract<AnalysisRecord["result"], { readonly type: "phrase-analysis-v2" }>;
}) {
  return (
    <div>
      <dl className="analysis-history-fields">
        <div>
          <dt>翻译</dt>
          <dd>{result.translationZh}</dd>
        </div>
        <div>
          <dt>语境含义</dt>
          <dd>{result.contextualMeaningZh}</dd>
        </div>
        {result.register !== undefined && (
          <div>
            <dt>语域</dt>
            <dd>{registerLabels[result.register] ?? result.register}</dd>
          </div>
        )}
        <div>
          <dt>结构与搭配</dt>
          <dd>
            {result.structureAndCollocationZh.length === 0 ? (
              "暂无。"
            ) : (
              <ul>
                {result.structureAndCollocationZh.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <TeachingPoints points={result.usageNotes} title="用法提示" />
    </div>
  );
}

function PassageResultView({ result }: { readonly result: PassageResult }) {
  return (
    <div>
      <section>
        <h4>整体理解</h4>
        <dl className="analysis-history-fields">
          <div>
            <dt>全文翻译</dt>
            <dd>{result.overall.translationZh}</dd>
          </div>
          <div>
            <dt>内容理解</dt>
            <dd>{result.overall.understandingZh}</dd>
          </div>
          {result.overall.contextAndToneZh !== undefined && (
            <div>
              <dt>语境与语气</dt>
              <dd>{result.overall.contextAndToneZh}</dd>
            </div>
          )}
        </dl>
      </section>
      <section>
        <h4>逐句讲解</h4>
        <ol>
          {result.sentences.map((sentence, index) => (
            <li key={sentence.analysisUnitId}>
              <h5>第 {index + 1} 句</h5>
              <p>原文：{sentence.sourceText}</p>
              <p>翻译：{sentence.translationZh}</p>
              <TeachingPoints points={sentence.grammar} title="语法" />
              <TeachingPoints points={sentence.structure} title="结构" />
              <TeachingPoints points={sentence.expressions} title="表达" />
              <TeachingPoints points={sentence.languageNotes} title="语言提示" />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Candidate({ candidate }: { readonly candidate: AnalysisRecord["candidates"][number] }) {
  const payload = candidate.payload;
  const title = payload.type === "expression" ? payload.text : payload.template;
  return (
    <li>
      <strong>{title}</strong>
      <span>{payload.type === "expression" ? "表达" : "句型"}</span>
      <dl className="analysis-history-fields">
        {payload.type === "expression" ? (
          <>
            <div>
              <dt>含义</dt>
              <dd>{payload.meaningZh}</dd>
            </div>
            <div>
              <dt>用法</dt>
              <dd>{payload.usageZh}</dd>
            </div>
            {payload.register !== undefined && (
              <div>
                <dt>语域</dt>
                <dd>{registerLabels[payload.register] ?? payload.register}</dd>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <dt>功能</dt>
              <dd>{payload.functionZh}</dd>
            </div>
            <div>
              <dt>用法</dt>
              <dd>{payload.usageZh}</dd>
            </div>
            <div>
              <dt>可替换部分</dt>
              <dd>
                <ul>
                  {payload.slots.map((slot) => (
                    <li key={slot.name}>
                      <strong>{slot.name}</strong>：{slot.descriptionZh}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </>
        )}
      </dl>
    </li>
  );
}

export function AnalysisHistoryDetail({ record }: { readonly record: AnalysisRecord }) {
  return (
    <>
      <div className="analysis-history-metadata">
        <p>
          <strong>来源：</strong>
          {sourceLabels[record.source.type]} · {record.source.title ?? "无标题"}
        </p>
        {record.source.userContext !== undefined && (
          <p>
            <strong>补充语境：</strong>
            {record.source.userContext}
          </p>
        )}
        <p>
          <strong>内容类型：</strong>
          {selectionLabels[record.selectionKind]}
        </p>
        <p>
          <strong>整理状态：</strong>
          {record.reviewState === "reviewed" ? "已整理" : "待整理"}
        </p>
        <p>
          <strong>归档状态：</strong>
          {record.archivedAt === null ? "未归档" : "已归档"}
        </p>
        <p>
          <strong>创建：</strong>
          {formatInstant(record.createdAt)}
        </p>
        <p>
          <strong>更新：</strong>
          {formatInstant(record.updatedAt)}
        </p>
        {record.archivedAt !== null && (
          <p>
            <strong>归档：</strong>
            {formatInstant(record.archivedAt)}
          </p>
        )}
      </div>
      <section>
        <h3>原文</h3>
        <p className="analysis-history-source">{record.sourceText}</p>
      </section>
      <section className="analysis-history-result">
        <h3>分析结果</h3>
        {record.result.type === "phrase-analysis-v2" ? (
          <PhraseResult result={record.result} />
        ) : (
          <PassageResultView result={record.result} />
        )}
      </section>
      <section>
        <h3>可整理候选</h3>
        {record.candidates.length === 0 ? (
          <p>没有候选。</p>
        ) : (
          <ol className="analysis-history-candidates">
            {record.candidates.map((candidate) => (
              <Candidate candidate={candidate} key={candidate.id} />
            ))}
          </ol>
        )}
      </section>
      <section className="analysis-history-model">
        <h3>模型信息</h3>
        <p>
          {record.modelMetadata.provider === "deepseek" ? "DeepSeek" : "OpenAI"} ·{" "}
          {record.modelMetadata.model}
        </p>
        <p>
          输入 token {record.modelMetadata.inputTokens ?? "未提供"} · 输出 token{" "}
          {record.modelMetadata.outputTokens ?? "未提供"}
        </p>
      </section>
    </>
  );
}
