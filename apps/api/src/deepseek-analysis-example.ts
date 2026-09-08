import type { StartAnalysisRequest } from "@huayi/cloud-contracts";
const examples = {
  phrase: {
    previewZh: "先把 run out of 作为整体看，它表示某种资源耗尽。",
    result: {
      translationZh: "时间用完",
      contextualMeaningZh: "原来可用的时间已经用尽，往往意味着事情来不及完成。",
      structureAndCollocationZh: ["run out of + 资源：of 后面要保留资源名词。"],
      usageNotes: [
        {
          label: "说明资源耗尽",
          evidenceText: "run out of time",
          explanationZh: "重点是可用时间耗尽，不是人从某处跑出去。",
          generatedExample: {
            sourceText: "We ran out of time before we could check the last page.",
            translationZh: "我们还没来得及检查最后一页，时间就用完了。",
          },
        },
      ],
      candidates: [
        {
          type: "expression",
          text: "run out of time",
          meaningZh: "时间用完；来不及完成",
          usageZh: "run out of 后接所耗尽的资源，of 后保留宾语。此处是时间不够。",
        },
      ],
    },
  },
  sentence: {
    previewZh: "先看包裹处于怎样的状态，再理解 seems 保留的推测语气。",
    result: {
      overall: {
        translationZh: "你的包裹似乎被寄到了错误的地址。",
        understandingZh: "seems 保留推测，完成被动不定式说明所推测的寄送发生在这一判断之前。",
      },
      sentences: [
        {
          translationZh: "你的包裹似乎被寄到了错误的地址。",
          structure: [
            {
              label: "包裹是被寄送的对象",
              evidenceText: "Your parcel seems to have been sent to the wrong address",
              explanationZh:
                "主干是 Your parcel seems...；不定式部分说明推测的情况，to the wrong address 指寄送目的地。",
            },
          ],
          grammar: [
            {
              label: "判断之前的被动动作",
              evidenceText: "seems to have been sent",
              explanationZh:
                "seems 是现在的判断；to have been sent 是完成被动不定式，寄送被认为早于判断，包裹承受这个动作。seems 使整个结论仍带推测。",
              generatedExample: {
                sourceText: "The file appears to have been deleted by mistake.",
                translationZh: "这个文件似乎被误删了。",
              },
            },
          ],
          expressions: [],
          languageNotes: [],
          candidates: [
            {
              type: "sentence_pattern",
              template: "{subject} seems to have been {pastParticiplePhrase}.",
              slots: [
                {
                  name: "subject",
                  descriptionZh: "承受动作的单数主语，如 the parcel",
                },
                {
                  name: "pastParticiplePhrase",
                  descriptionZh: "过去分词及必要补足成分，如 sent to the wrong address",
                },
              ],
              sourceValues: [
                { name: "subject", text: "Your parcel" },
                { name: "pastParticiplePhrase", text: "sent to the wrong address" },
              ],
              functionZh: "推测某对象先前遭遇了某个动作",
              usageZh:
                "seems 表示当前的推测；完成被动部分表示被认为先于判断的动作。槽中保留必要的宾语、补语或地点等成分。",
            },
          ],
        },
      ],
    },
  },
};
export function deepSeekAnalysisExample(kind: StartAnalysisRequest["selectionKind"]): string {
  return [
    "Shape example for a DIFFERENT input; do not reuse its content for the actual input:",
    JSON.stringify(examples[kind === "phrase" ? "phrase" : "sentence"]),
  ].join("\n");
}
