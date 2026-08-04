declare module "wink-lemmatizer" {
  interface WinkLemmatizer {
    adjective(word: string): string;
    noun(word: string): string;
    verb(word: string): string;
  }

  const lemmatizer: WinkLemmatizer;
  // eslint-disable-next-line no-restricted-syntax -- The CommonJS package exposes one object.
  export default lemmatizer;
}
