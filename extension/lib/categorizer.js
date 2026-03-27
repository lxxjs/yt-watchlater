// Smart local categorization engine
// Channel-first grouping + TF-IDF keyword clustering
// Runs entirely in-browser, no external APIs

// --- Stopwords ---

const STOPWORDS = new Set([
  // English common
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'just',
  'also', 'very', 'too', 'about', 'up', 'out', 'into', 'over', 'after', 'before',
  'between', 'under', 'above', 'again', 'once', 'here', 'there', 'any', 'as',
  // YouTube filler
  'official', 'video', 'music', 'full', 'hd', '4k', '1080p', '720p', 'new', 'latest',
  'best', 'top', 'part', 'episode', 'ep', 'ft', 'feat', 'vs', 'live', 'remix',
  'lyrics', 'lyric', 'audio', 'clip', 'trailer', 'teaser', 'reaction', 'review',
  'tutorial', 'guide', 'how', 'tips', 'tricks', 'update', 'highlights',
]);

// --- Text Processing ---

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function getVideoText(video) {
  // Weighted text: title 3x, tags 2x, description 1x
  const titleTokens = tokenize(video.title);
  const tagTokens = (video.tags || []).flatMap(t => tokenize(t));
  const descTokens = tokenize(video.description || '');

  return [
    ...titleTokens, ...titleTokens, ...titleTokens,  // 3x weight
    ...tagTokens, ...tagTokens,                       // 2x weight
    ...descTokens,                                    // 1x weight
  ];
}

// --- TF-IDF ---

function computeTFIDF(documents) {
  const N = documents.length;
  const df = new Map(); // document frequency per term

  // Compute document frequency
  for (const doc of documents) {
    const uniqueTerms = new Set(doc.tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  // Compute TF-IDF vectors
  return documents.map(doc => {
    const tf = new Map();
    for (const term of doc.tokens) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }

    const vector = new Map();
    const maxTf = Math.max(...tf.values(), 1);

    for (const [term, count] of tf) {
      const normalizedTf = count / maxTf;
      const idf = Math.log(N / (df.get(term) || 1));
      const tfidf = normalizedTf * idf;
      if (tfidf > 0) {
        vector.set(term, tfidf);
      }
    }

    return { ...doc, vector };
  });
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, valA] of vecA) {
    normA += valA * valA;
    const valB = vecB.get(term);
    if (valB) dotProduct += valA * valB;
  }

  for (const [, valB] of vecB) {
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- K-Means Clustering ---

function kMeansClustering(documents, k, maxIterations = 20) {
  if (documents.length === 0) return [];
  if (documents.length <= k) {
    return documents.map(d => [d]);
  }

  // Initialize centroids using k-means++ style
  const centroids = [];
  const usedIndices = new Set();

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * documents.length);
  centroids.push(documents[firstIdx].vector);
  usedIndices.add(firstIdx);

  // Pick remaining centroids weighted by distance
  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let bestIdx = 0;

    for (let i = 0; i < documents.length; i++) {
      if (usedIndices.has(i)) continue;
      const minSim = Math.min(
        ...centroids.map(cent => cosineSimilarity(documents[i].vector, cent))
      );
      const dist = 1 - minSim;
      if (dist > maxDist) {
        maxDist = dist;
        bestIdx = i;
      }
    }

    centroids.push(documents[bestIdx].vector);
    usedIndices.add(bestIdx);
  }

  let assignments = new Array(documents.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each doc to nearest centroid
    const newAssignments = documents.map((doc, i) => {
      let bestCluster = 0;
      let bestSim = -1;

      for (let c = 0; c < centroids.length; c++) {
        const sim = cosineSimilarity(doc.vector, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }

      return bestCluster;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;

    if (!changed) break;

    // Recompute centroids
    for (let c = 0; c < k; c++) {
      const clusterDocs = documents.filter((_, i) => assignments[i] === c);
      if (clusterDocs.length === 0) continue;

      const newCentroid = new Map();
      for (const doc of clusterDocs) {
        for (const [term, val] of doc.vector) {
          newCentroid.set(term, (newCentroid.get(term) || 0) + val / clusterDocs.length);
        }
      }
      centroids[c] = newCentroid;
    }
  }

  // Group documents by cluster
  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < documents.length; i++) {
    clusters[assignments[i]].push(documents[i]);
  }

  return clusters.filter(c => c.length > 0);
}

// --- Topic Name Generation ---

function generateTopicName(videos, allDocuments) {
  // Collect all tokens from videos in this group
  const groupTokens = new Map();
  for (const v of videos) {
    const tokens = tokenize(v.title);
    for (const t of tokens) {
      groupTokens.set(t, (groupTokens.get(t) || 0) + 1);
    }
  }

  // Calculate global frequency to find distinctive terms
  const globalTokens = new Map();
  for (const doc of allDocuments) {
    const seen = new Set();
    for (const t of tokenize(doc.title)) {
      if (!seen.has(t)) {
        globalTokens.set(t, (globalTokens.get(t) || 0) + 1);
        seen.add(t);
      }
    }
  }

  // Score terms by distinctiveness (frequency in group vs global)
  const scored = [];
  for (const [term, count] of groupTokens) {
    const globalCount = globalTokens.get(term) || 1;
    const distinctiveness = (count / videos.length) / (globalCount / allDocuments.length);
    scored.push({ term, count, distinctiveness });
  }

  scored.sort((a, b) => b.distinctiveness - a.distinctiveness);

  // Pick top 2-3 distinctive terms
  const topTerms = scored
    .slice(0, 3)
    .map(s => s.term)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1));

  return topTerms.join(' & ') || 'Miscellaneous';
}

// --- Main Categorization ---

function categorizeVideos(videos) {
  if (videos.length === 0) return new Map();

  const MIN_CHANNEL_GROUP = 5;
  const MIN_GROUP_SIZE = 3;

  // Phase 1: Group by channel
  const channelMap = new Map();
  for (const video of videos) {
    const channel = video.channel || 'Unknown';
    if (!channelMap.has(channel)) channelMap.set(channel, []);
    channelMap.get(channel).push(video);
  }

  const groups = new Map();
  const ungrouped = [];

  for (const [channel, vids] of channelMap) {
    if (vids.length >= MIN_CHANNEL_GROUP) {
      groups.set(channel, vids);
    } else {
      ungrouped.push(...vids);
    }
  }

  // Phase 2: TF-IDF clustering for ungrouped videos
  if (ungrouped.length > 0) {
    const documents = ungrouped.map(v => ({
      video: v,
      tokens: getVideoText(v),
    }));

    const tfidfDocs = computeTFIDF(documents);

    // Determine number of clusters
    const k = Math.max(2, Math.min(15, Math.floor(Math.sqrt(ungrouped.length / 2))));

    const clusters = kMeansClustering(tfidfDocs, k);

    for (const cluster of clusters) {
      const clusterVideos = cluster.map(d => d.video);
      const topicName = generateTopicName(clusterVideos, videos);
      groups.set(topicName, clusterVideos);
    }
  }

  // Post-processing: merge small groups
  const mergedGroups = mergeSmallGroups(groups, MIN_GROUP_SIZE, videos);

  // Sort by size descending
  const sorted = new Map(
    [...mergedGroups.entries()].sort((a, b) => b[1].length - a[1].length)
  );

  return sorted;
}

function mergeSmallGroups(groups, minSize, allVideos) {
  const result = new Map();
  const smallGroups = [];

  for (const [name, videos] of groups) {
    if (videos.length >= minSize) {
      result.set(name, videos);
    } else {
      smallGroups.push({ name, videos });
    }
  }

  if (smallGroups.length === 0) return result;

  // Merge small groups into nearest large group by keyword similarity
  if (result.size === 0) {
    // All groups are small — just combine into "Miscellaneous"
    const allSmall = smallGroups.flatMap(g => g.videos);
    result.set('Miscellaneous', allSmall);
    return result;
  }

  // Compute a keyword fingerprint for each large group
  const groupFingerprints = new Map();
  for (const [name, videos] of result) {
    const tokens = new Map();
    for (const v of videos) {
      for (const t of tokenize(v.title)) {
        tokens.set(t, (tokens.get(t) || 0) + 1);
      }
    }
    groupFingerprints.set(name, tokens);
  }

  for (const { videos } of smallGroups) {
    // Find best matching large group
    const smallTokens = new Map();
    for (const v of videos) {
      for (const t of tokenize(v.title)) {
        smallTokens.set(t, (smallTokens.get(t) || 0) + 1);
      }
    }

    let bestGroup = null;
    let bestSim = -1;

    for (const [name, fingerprint] of groupFingerprints) {
      const sim = cosineSimilarity(smallTokens, fingerprint);
      if (sim > bestSim) {
        bestSim = sim;
        bestGroup = name;
      }
    }

    if (bestGroup && bestSim > 0.05) {
      result.get(bestGroup).push(...videos);
    } else {
      // No good match — add to Miscellaneous
      if (!result.has('Miscellaneous')) result.set('Miscellaneous', []);
      result.get('Miscellaneous').push(...videos);
    }
  }

  return result;
}

export { categorizeVideos, tokenize, computeTFIDF, cosineSimilarity };
