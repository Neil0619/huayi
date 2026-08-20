import type { AnalysisRecord } from "@huayi/cloud-contracts";

const labels: Readonly<Record<string, string>> = {
  baseForm: "基本形式",
  candidateIds: "候选 ID",
  collocations: "常见搭配",
  commonMeanings: "常见含义",
  commonPhrases: "常用短语",
  confusableWords: "易混词",
  contextAndToneZh: "语境与语气",
  contextExample: "语境例句",
  contextualAnalysisZh: "语境解析",
  contextualMeaningZh: "语境含义",
  contextualSense: "当前语义",
  coreMeanings: "核心含义",
  descriptionZh: "说明",
  dictionaryForm: "词典形式",
  distinctionZh: "区别",
  english: "英文",
  explanationZh: "解释",
  formTypeZh: "词形",
  functionZh: "功能",
  grammarNotes: "语法说明",
  keyExpressions: "关键表达",
  mainStructure: "主要结构",
  meaningZh: "含义",
  meaningsZh: "含义",
  ordinal: "顺序",
  overall: "整体理解",
  partOfSpeech: "词性",
  pronunciation: "发音",
  register: "语域",
  requestId: "请求 ID",
  schemaVersion: "结构版本",
  selectionKind: "选择类型",
  sentenceRoleZh: "句中作用",
  sentences: "逐句解析",
  similarTerms: "近义表达",
  slots: "槽位",
  sourceText: "原文",
  structureZh: "句子结构",
  synonyms: "近义词",
  template: "模板",
  text: "文本",
  titleZh: "标题",
  translationZh: "翻译",
  type: "结果类型",
  uk: "英式",
  understandingZh: "整体理解",
  usageNotes: "用法提示",
  usageZh: "用法",
  us: "美式",
  wordForm: "词形信息",
  wordFormation: "构词",
  wordFormationZh: "构词说明",
};

function StructuredValue({ name, value }: { readonly name: string; readonly value: unknown }) {
  const label = labels[name] ?? name;
  if (Array.isArray(value)) {
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {value.length === 0 ? (
            "无"
          ) : (
            <ol>
              {value.map((entry, index) => (
                <li key={index}>
                  {typeof entry === "object" && entry !== null ? (
                    <StructuredObject value={entry} />
                  ) : (
                    String(entry)
                  )}
                </li>
              ))}
            </ol>
          )}
        </dd>
      </div>
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          <StructuredObject value={value} />
        </dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === undefined || value === null ? "未提供" : String(value)}</dd>
    </div>
  );
}

function StructuredObject({ value }: { readonly value: object }) {
  return (
    <dl className="analysis-history-fields">
      {Object.entries(value).map(([name, entry]) => (
        <StructuredValue key={name} name={name} value={entry} />
      ))}
    </dl>
  );
}

function Candidate({ candidate }: { readonly candidate: AnalysisRecord["candidates"][number] }) {
  const payload = candidate.payload;
  const title = payload.type === "expression" ? payload.text : payload.template;
  return (
    <li>
      <strong>{title}</strong>
      <span>{candidate.type === "expression" ? "表达" : "句型"}</span>
      <p>
        候选 {candidate.id} · 第 {candidate.ordinal + 1} 项 · 分析单元 {candidate.analysisUnitId}
      </p>
      <StructuredObject value={payload} />
    </li>
  );
}

export function AnalysisHistoryDetail({ record }: { readonly record: AnalysisRecord }) {
  return (
    <>
      <div className="analysis-history-metadata">
        <p>
          <strong>记录：</strong>
          {record.id} · revision {record.revision}
        </p>
        <p>
          <strong>来源：</strong>
          {record.source.type} · {record.source.title ?? "无标题"}
        </p>
        <p>
          <strong>选择类型：</strong>
          {record.selectionKind}
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
          {record.createdAt}
        </p>
        <p>
          <strong>更新：</strong>
          {record.updatedAt}
        </p>
        {record.archivedAt !== null && (
          <p>
            <strong>归档：</strong>
            {record.archivedAt}
          </p>
        )}
      </div>
      <section>
        <h3>原文</h3>
        <p className="analysis-history-source">{record.sourceText}</p>
      </section>
      <section className="analysis-history-result">
        <h3>分析结果</h3>
        <StructuredObject value={record.result} />
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
        <h3>公开模型信息</h3>
        <p>
          {record.modelMetadata.provider} · {record.modelMetadata.model}
        </p>
        <p>
          Prompt {record.modelMetadata.promptVersion} · Schema {record.modelMetadata.schemaVersion}
        </p>
        <p>
          输入 token {record.modelMetadata.inputTokens ?? "未提供"} · 输出 token{" "}
          {record.modelMetadata.outputTokens ?? "未提供"}
        </p>
      </section>
    </>
  );
}
