import pptxgen from 'pptxgenjs';
export type ReportSection = { title: string; image?: string; rows?: string[][] };
export async function exportPptx(sections: ReportSection[], filename: string, options: { range: string; org: string; signal?: AbortSignal; onProgress?: (value: number) => void }) {
  const ppt = new pptxgen(); ppt.author = 'SocialFlow'; ppt.addSlide().addText(`Analytics report\n${options.org}\n${options.range}`, { x: 1, y: 1, w: 8, h: 2 });
  for (let i = 0; i < sections.length; i++) { if (options.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); const section = sections[i]; const slide = ppt.addSlide(); slide.addText(section.title, { x: 0.5, y: 0.3, w: 9, h: 0.4 }); if (section.image) slide.addImage({ data: section.image, x: 0.5, y: 0.9, w: 9, h: 5 }); if (section.rows) slide.addTable(section.rows, { x: 0.5, y: 1, w: 9, h: 4 }); options.onProgress?.(Math.round(((i + 1) / sections.length) * 100)); await new Promise(resolve => setTimeout(resolve, 0)); }
  await ppt.writeFile({ fileName: filename });
}
