const VIEWERS = [
  ['pdfjs', 'PDF.js'],
  ['embedpdf', 'EmbedPDF'],
  ['mupdf', 'MuPDF.js'],
];

const papers = await (await fetch('/api/papers')).json();
const body = document.getElementById('papers');
for (const paper of papers) {
  const row = body.insertRow();
  const about = row.insertCell();
  about.append(paper.title, document.createElement('br'));
  const kind = document.createElement('small');
  kind.textContent = paper.kind;
  about.append(kind);
  const links = row.insertCell();
  for (const [name, label] of VIEWERS) {
    const link = document.createElement('a');
    link.href = `/view/${name}?paper=${encodeURIComponent(paper.id)}`;
    link.textContent = label;
    links.append(link);
  }
}
