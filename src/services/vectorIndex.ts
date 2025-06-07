import {HierarchicalNSW} from 'hnswlib-node'

export class VectorIndex {
    private index: HierarchicalNSW | null = null

    constructor(private dimension: number) {}

    build(vectors: number[][]): void {
        this.index = new HierarchicalNSW('cosine', this.dimension)
        this.index.initIndex({maxElements: vectors.length})
        for (const [index, vec] of vectors.entries()) this.index!.addPoint(vec, index)
    }

    search(query: number[], k: number): {id: number; distance: number}[] {
        if (!this.index) {
            return []
        }
        const result = this.index.searchKnn(query, k)
        return result.neighbors.map((id, index) => ({
            id,
            distance: result.distances[index],
        }))
    }
}
