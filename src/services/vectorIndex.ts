import { HierarchicalNSW } from "hnswlib-node";

export class VectorIndex {
  private index: HierarchicalNSW | null = null;

  constructor(private dimension: number) {}

  build(vectors: number[][]): void {
    this.index = new HierarchicalNSW("cosine", this.dimension);
    this.index.initIndex({ maxElements: vectors.length });
    vectors.forEach((vec, i) => this.index!.addPoint(vec, i));
  }

  search(query: number[], k: number): { id: number; distance: number }[] {
    if (!this.index) {
      return [];
    }
    const result = this.index.searchKnn(query, k);
    return result.neighbors.map((id, i) => ({
      id,
      distance: result.distances[i],
    }));
  }
}
