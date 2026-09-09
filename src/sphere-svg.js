export function drawSphereSVG(stars, asterisms) {

  const width = 1200;
  const height = 600;

  let svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}"
     height="${height}"
     viewBox="0 0 ${width} ${height}">

<rect x="0" y="0"
      width="${width}"
      height="${height}"
      fill="black"/>
`;

  // Draw stars
  stars.forEach(s => {

    const p = s.point;

    const longitude = Math.atan2(p.x, p.z);
    const latitude = Math.asin(p.y / p.length());

    const x =
      (longitude + Math.PI) /
      (2 * Math.PI) *
      width;

    const y =
      (Math.PI / 2 - latitude) /
      Math.PI *
      height;

    svg += `
<circle
  cx="${x}"
  cy="${y}"
  r="2"
  fill="white"/>
`;
  });


  // Draw asterisms
  Object.keys(asterisms).forEach(name => {

    const lines = asterisms[name];

    for (let i = 0; i < lines.length; i += 2) {

      const a = lines[i];
      const b = lines[i + 1];

      if (!a || !b) continue;

      const longitude1 = Math.atan2(a.x, a.z);
      const latitude1 = Math.asin(a.y / a.length());

      const longitude2 = Math.atan2(b.x, b.z);
      const latitude2 = Math.asin(b.y / b.length());

      const x1 =
        (longitude1 + Math.PI) /
        (2 * Math.PI) *
        width;

      const y1 =
        (Math.PI / 2 - latitude1) /
        Math.PI *
        height;

      const x2 =
        (longitude2 + Math.PI) /
        (2 * Math.PI) *
        width;

      const y2 =
        (Math.PI / 2 - latitude2) /
        Math.PI *
        height;

      svg += `
<line
  x1="${x1}"
  y1="${y1}"
  x2="${x2}"
  y2="${y2}"
  stroke="white"
  stroke-width="1"/>
`;
    }
  });

  svg += `
</svg>
`;

  const blob = new Blob(
    [svg],
    { type: 'image/svg+xml;charset=utf-8' }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');

  link.href = url;
  link.download = 'sphere-star-map.svg';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}