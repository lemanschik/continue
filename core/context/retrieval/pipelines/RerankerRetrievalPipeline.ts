import { Chunk } from "../../../index.js";
import { RETRIEVAL_PARAMS } from "../../../util/parameters.js";
import { deduplicateChunks } from "../util.js";
import BaseRetrievalPipeline, {
  RetrievalPipelineRunArguments,
} from "./BaseRetrievalPipeline.js";

export default class RerankerRetrievalPipeline extends BaseRetrievalPipeline {
  private async _retrieveInitial(
    args: RetrievalPipelineRunArguments,
  ): Promise<Chunk[]> {
    const { nRetrieve } = this.options;

    const retrievalResults: Chunk[] = [];

    const ftsChunks = await this.retrieveFts(args, nRetrieve);
    const embeddingsChunks = await this.retrieveEmbeddings(args, nRetrieve);
    const recentlyEditedFilesChunks =
      await this.retrieveAndChunkRecentlyEditedFiles(nRetrieve);

    retrievalResults.push(
      ...recentlyEditedFilesChunks,
      ...ftsChunks,
      ...embeddingsChunks,
    );

    const deduplicatedRetrievalResults: Chunk[] =
      deduplicateChunks(retrievalResults);

    return deduplicatedRetrievalResults;
  }

  private async _rerank(input: string, chunks: Chunk[]): Promise<Chunk[]> {
    if (!this.options.reranker) {
      throw new Error("No reranker provided");
    }

    let scores: number[] = await this.options.reranker.rerank(input, chunks);

    // Filter out low-scoring results
    let results = chunks;
    // let results = chunks.filter(
    //   (_, i) => scores[i] >= RETRIEVAL_PARAMS.rerankThreshold,
    // );
    // scores = scores.filter(
    //   (score) => score >= RETRIEVAL_PARAMS.rerankThreshold,
    // );

    results.sort(
      (a, b) => scores[results.indexOf(a)] - scores[results.indexOf(b)],
    );
    results = results.slice(-this.options.nFinal);
    return results;
  }

  private async _expandWithEmbeddings(
    args: RetrievalPipelineRunArguments,
    chunks: Chunk[],
  ): Promise<Chunk[]> {
    const topResults = chunks.slice(
      -RETRIEVAL_PARAMS.nResultsToExpandWithEmbeddings,
    );

    const expanded = await Promise.all(
      topResults.map(async (chunk, i) => {
        const results = await this.retrieveEmbeddings(
          {
            ...args,
            query: chunk.content,
          },
          RETRIEVAL_PARAMS.nEmbeddingsExpandTo,
        );
        return results;
      }),
    );
    return expanded.flat();
  }

  private async _expandRankedResults(
    args: RetrievalPipelineRunArguments,
    chunks: Chunk[],
  ): Promise<Chunk[]> {
    let results: Chunk[] = [];

    const embeddingsResults = await this._expandWithEmbeddings(args, chunks);
    results.push(...embeddingsResults);

    return results;
  }

  async run(args: RetrievalPipelineRunArguments): Promise<Chunk[]> {
    // Retrieve initial results
    let results = await this._retrieveInitial(args);

    // Rerank
    results = await this._rerank(args.query, results);

    // // // Expand top reranked results
    // const expanded = await this._expandRankedResults(results);
    // results.push(...expanded);

    // // De-duplicate
    // results = deduplicateChunks(results);

    // // Rerank again
    // results = await this._rerank(input, results);

    // TODO: stitch together results

    return results;
  }
}

// Source: expansion with code graph
// consider doing this after reranking? Or just having a lower reranking threshold
// This is VS Code only until we use PSI for JetBrains or build our own general solution
// TODO: Need to pass in the expandSnippet function as a function argument
// because this import causes `tsc` to fail
// if ((await extras.ide.getIdeInfo()).ideType === "vscode") {
//   const { expandSnippet } = await import(
//     "../../../extensions/vscode/src/util/expandSnippet"
//   );
//   let expansionResults = (
//     await Promise.all(
//       extras.selectedCode.map(async (rif) => {
//         return expandSnippet(
//           rif.filepath,
//           rif.range.start.line,
//           rif.range.end.line,
//           extras.ide,
//         );
//       }),
//     )
//   ).flat() as Chunk[];
//   retrievalResults.push(...expansionResults);
// }

// Source: Open file exact match
// Source: Class/function name exact match
