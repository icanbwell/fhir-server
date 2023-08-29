/**
 * @classdesc Implementation of BM25 algorithm
 */
class BM25 {
    constructor(docs) {
        this.docs = docs;
        this.docLengths = docs.map(doc => doc.split(/\s+/).length);
        this.avgDocLength = this.docLengths.reduce((acc, val) => acc + val, 0) / this.docLengths.length;
        this.docCount = this.docs.length;
        this.k1 = 1.5;
        this.b = 0.75;
        this.invertedIndex = this.buildInvertedIndex();
    }

    buildInvertedIndex() {
        let index = {};
        this.docs.forEach((doc, docID) => {
            let terms = doc.split(/\s+/);
            terms.forEach(term => {
                if (!index[`${term}`]) {
                    index[`${term}`] = [];
                }
                if (!index[`${term}`].includes(docID)) {
                    index[`${term}`].push(docID);
                }
            });
        });
        return index;
    }

    idf(term) {
        if (!this.invertedIndex[term]) {
            return 0;
        }
        let docFreq = this.invertedIndex[term].length;
        return Math.log((this.docCount - docFreq + 0.5) / (docFreq + 0.5) + 1.0);
    }

    score(query, docID) {
        let doc = this.docs[docID];
        let terms = query.split(/\s+/);
        let score = 0;
        terms.forEach(term => {
            let tf = (doc.match(new RegExp('\\b' + term + '\\b', 'gi')) || []).length;
            let idfValue = this.idf(term);
            score += idfValue * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * this.docLengths[docID] / this.avgDocLength)));
        });
        return score;
    }

    rank(query) {
        let scores = this.docs.map((_, docID) => ({
            docID,
            score: this.score(query, docID)
        }));

        return scores.sort((a, b) => b.score - a.score);
    }
}

module.exports = {
    BM25
};
