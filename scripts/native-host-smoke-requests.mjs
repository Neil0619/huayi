function analyzeRequest({
  action,
  context,
  requestId,
  schemaVersion,
  selection,
  selectionKind,
  sentenceContext,
}) {
  return {
    action,
    context,
    requestId,
    schemaVersion,
    selection,
    selectionKind,
    sentenceContext,
    targetLanguage: "zh-CN",
    type: "analyze",
  };
}

export function createSmokeRequests(schemaVersion) {
  const investigation = "He said the investigation was in its early stages.";
  const sustained = "The recovery remained sustained throughout the difficult winter.";
  const victims = "The victims received immediate support from local volunteers.";
  const accountable = "Managers are accountable for the safety of their teams.";
  const four = "Four students presented their findings to the class.";
  const heatwave = "The region experienced a sustained heatwave throughout July.";
  const sentence =
    "He said the investigation was in the early stages and urged anyone with information to come forward.";
  const paragraph =
    "The investigation remains in its early stages.\nOfficials asked witnesses to come forward with information.";

  return [
    analyzeRequest({
      action: "translate",
      context: investigation,
      requestId: "smoke-investigation",
      schemaVersion,
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: investigation,
    }),
    analyzeRequest({
      action: "translate",
      context: sustained,
      requestId: "smoke-sustained",
      schemaVersion,
      selection: "sustained",
      selectionKind: "word",
      sentenceContext: sustained,
    }),
    analyzeRequest({
      action: "explain",
      context: victims,
      requestId: "smoke-victims",
      schemaVersion,
      selection: "victims",
      selectionKind: "word",
      sentenceContext: victims,
    }),
    analyzeRequest({
      action: "explain",
      context: accountable,
      requestId: "smoke-accountable",
      schemaVersion,
      selection: "accountable",
      selectionKind: "word",
      sentenceContext: accountable,
    }),
    analyzeRequest({
      action: "translate",
      context: four,
      requestId: "smoke-four",
      schemaVersion,
      selection: "Four",
      selectionKind: "word",
      sentenceContext: four,
    }),
    analyzeRequest({
      action: "explain",
      context: heatwave,
      requestId: "smoke-sustained-heatwave",
      schemaVersion,
      selection: "sustained heatwave",
      selectionKind: "phrase",
      sentenceContext: heatwave,
    }),
    analyzeRequest({
      action: "explain",
      context: sentence,
      requestId: "smoke-sentence",
      schemaVersion,
      selection: sentence,
      selectionKind: "sentence",
      sentenceContext: null,
    }),
    analyzeRequest({
      action: "translate",
      context: paragraph,
      requestId: "smoke-paragraph",
      schemaVersion,
      selection: paragraph,
      selectionKind: "paragraph",
      sentenceContext: null,
    }),
  ];
}
