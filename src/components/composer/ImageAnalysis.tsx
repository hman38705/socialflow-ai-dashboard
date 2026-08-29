/**
 * ImageAnalysis — image analysis via AiService.postAiAnalyzeImage (FE-068).
 *
 * Opt-in per image (never automatic on upload — bandwidth and credit
 * cost). Produces a suggested alt text from the AI caption plus content
 * tags derived client-side from that caption via the existing
 * hashtagGenerator utility. "Use as alt text" hands the caption to the
 * caller via `onApplyAltText`, which the composer wires to the FE-063 alt
 * field once that field exists. Analysis failures are caught and shown as
 * a dismissible, non-blocking error — they never prevent posting.
 */
import React, { useState } from 'react';
import { AiService } from '../../api/services/AiService';
import { generateHashtags } from '../../utils/hashtagGenerator';

export interface ImageAnalysisProps {
  /** Base64-encoded image data or a public image URL, per AiService's contract. */
  imageData: string;
  mimeType?: string;
  /** Target platform, used to bias the generated content tags. */
  platform?: string;
  /** Writes the suggested alt text into the FE-063 alt field. */
  onApplyAltText: (altText: string) => void;
}

interface AnalysisResult {
  altText: string;
  tags: string[];
}

export function ImageAnalysis({
  imageData,
  mimeType,
  platform,
  onApplyAltText,
}: ImageAnalysisProps): React.JSX.Element {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const analyze = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const { caption } = await AiService.postAiAnalyzeImage({
        requestBody: {
          imageData,
          mimeType,
          context: 'Suggest concise alt text and content tags for this image.',
        },
      });
      const altText = caption?.trim() ?? '';
      const { hashtags } = generateHashtags({ text: altText, platform });
      setResult({ altText, tags: hashtags });
    } catch (err) {
      // Non-blocking by design: an analysis failure must never prevent posting.
      setError(
        err instanceof Error
          ? err.message
          : 'Image analysis failed. You can still post without it.',
      );
    } finally {
      setIsLoading(false);
      setHasRun(true);
    }
  };

  return (
    <div className="image-analysis" data-testid="image-analysis">
      {!hasRun && !isLoading && (
        <button type="button" onClick={() => void analyze()}>
          Analyze image
        </button>
      )}

      {isLoading && <span>Analyzing…</span>}

      {error && (
        <div role="alert" className="image-analysis__error">
          <span>{error}</span>
          <button type="button" onClick={() => void analyze()}>
            Retry
          </button>
        </div>
      )}

      {result && !isLoading && (
        <div className="image-analysis__result">
          <p>{result.altText || 'No caption available.'}</p>
          {result.altText && (
            <button type="button" onClick={() => onApplyAltText(result.altText)}>
              Use as alt text
            </button>
          )}
          {result.tags.length > 0 && (
            <ul className="image-analysis__tags">
              {result.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
