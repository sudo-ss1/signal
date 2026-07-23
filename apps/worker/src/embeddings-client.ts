import OpenAI from "openai";

export async function embedText(client: OpenAI, text: string): Promise<number[]> {
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
