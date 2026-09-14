/**
 * Face View
 *
 * Creates a 2D SVG representation of a selected polygon/face.
 *
 * The view contains:
 *  - Face boundary
 *  - X and Y axes
 *  - Origin
 *  - Stars belonging to the selected face
 *  - Star names
 *  - X/Y position of every star
 *  - Star size based on magnitude when available
 */

const OVERLAY_ID = 'face-view-overlay';
const STYLE_ID = 'face-view-style';

function escapeXml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get the name of a star.
 *
 * Different catalog formats may use different property names,
 * so several common names are checked.
 */
function getStarName(star, index) {
  return (
    star.name ||
    star.properName ||
    star.starName ||
    star.catalogName ||
    star.id ||
    star.hd ||
    star.HD ||
    `Star ${index + 1}`
  );
}

/**
 * Get magnitude if available.
 */
function getMagnitude(star) {
  const value =
    star.magnitude !== undefined
      ? star.magnitude
      : star.mag !== undefined
        ? star.mag
        : star.vmag !== undefined
          ? star.vmag
          : null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

/**
 * Calculate the centre of a polygon.
 */
function getPolygonCenter(points) {
  const center = points[0].clone().set(0, 0, 0);

  points.forEach(point => {
    center.add(point);
  });

  center.multiplyScalar(1 / points.length);

  return center;
}

/**
 * Find a normal for the polygon.
 */
function getPolygonNormal(polygon) {
  if (
    polygon &&
    polygon.plane &&
    polygon.plane.normal
  ) {
    return polygon.plane.normal.clone().normalize();
  }

  const points = polygon.points;

  if (points.length >= 3) {
    const a = points[1].clone().sub(points[0]);
    const b = points[2].clone().sub(points[0]);

    return new a.constructor()
      .crossVectors(a, b)
      .normalize();
  }

  return points[0].clone().set(0, 0, 1);
}

/**
 * Create a local X/Y coordinate system on the polygon.
 *
 * X axis:
 *   First polygon edge projected onto the face.
 *
 * Y axis:
 *   Perpendicular direction inside the face.
 */
function createCoordinateSystem(polygon) {
  const points = polygon.points;
  const center = getPolygonCenter(points);
  const normal = getPolygonNormal(polygon);

  let xAxis = null;

  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;

    const edge = points[next]
      .clone()
      .sub(points[i]);

    // Remove the component along the normal.
    const normalComponent = normal.clone()
      .multiplyScalar(edge.dot(normal));

    edge.sub(normalComponent);

    if (edge.length() > 0.000001) {
      xAxis = edge.normalize();
      break;
    }
  }

  // Fallback if the polygon contains no usable edge.
  if (!xAxis) {
    xAxis = new points[0].constructor(1, 0, 0);

    if (Math.abs(xAxis.dot(normal)) > 0.9) {
      xAxis.set(0, 1, 0);
    }

    xAxis
      .sub(normal.clone().multiplyScalar(xAxis.dot(normal)))
      .normalize();
  }

  const yAxis = normal
    .clone()
    .cross(xAxis)
    .normalize();

  return {
    center,
    normal,
    xAxis,
    yAxis
  };
}

/**
 * Convert a 3D point into the local 2D coordinates of the face.
 */
function toFaceCoordinates(point, coordinateSystem) {
  const {
    center,
    xAxis,
    yAxis
  } = coordinateSystem;

  const relative = point.clone().sub(center);

  return {
    x: relative.dot(xAxis),
    y: relative.dot(yAxis)
  };
}

/**
 * Create the SVG representation.
 */
function createFaceSVG(faceData) {
  const polygon = faceData.polygon;
  const stars = faceData.stars || [];

  if (!polygon || !polygon.points || !polygon.points.length) {
    return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  }

  const coordinateSystem = createCoordinateSystem(polygon);

  const polygon2D = polygon.points.map(point =>
    toFaceCoordinates(point, coordinateSystem)
  );

  const stars2D = stars
    .filter(star => star && star.point)
    .map((star, index) => ({
      star,
      name: getStarName(star, index),
      magnitude: getMagnitude(star),
      ...toFaceCoordinates(star.point, coordinateSystem)
    }));

  const allPoints = [
    ...polygon2D,
    ...stars2D.map(star => ({
      x: star.x,
      y: star.y
    }))
  ];

  let minX = Math.min(...allPoints.map(p => p.x));
  let maxX = Math.max(...allPoints.map(p => p.x));
  let minY = Math.min(...allPoints.map(p => p.y));
  let maxY = Math.max(...allPoints.map(p => p.y));

  // Prevent zero-sized dimensions.
  if (Math.abs(maxX - minX) < 0.0001) {
    minX -= 1;
    maxX += 1;
  }

  if (Math.abs(maxY - minY) < 0.0001) {
    minY -= 1;
    maxY += 1;
  }

  const width = 1100;
  const height = 750;
  const margin = 90;

  const dataWidth = maxX - minX;
  const dataHeight = maxY - minY;

  const scale = Math.min(
    (width - margin * 2) / dataWidth,
    (height - margin * 2) / dataHeight
  );

  const centreX = width / 2;
  const centreY = height / 2;

  function screenX(x) {
    return centreX + x * scale;
  }

  function screenY(y) {
    // SVG Y axis points down, so invert mathematical Y.
    return centreY - y * scale;
  }

  const polygonPoints = polygon2D
    .map(point =>
      `${screenX(point.x)},${screenY(point.y)}`
    )
    .join(' ');

  /*
   * Determine the range used for the axes.
   */
  const axisLeft = screenX(minX);
  const axisRight = screenX(maxX);
  const axisTop = screenY(maxY);
  const axisBottom = screenY(minY);

  const originX = screenX(0);
  const originY = screenY(0);

  /*
   * Calculate star radius.
   *
   * Brighter stars have smaller magnitude, so they are
   * displayed slightly larger.
   */
  function starRadius(magnitude) {
    if (magnitude === null) {
      return 5;
    }

    return Math.max(
      4,
      Math.min(
        10,
        10 - magnitude * 0.8
      )
    );
  }

  const starsSvg = stars2D
    .map(star => {
      const x = screenX(star.x);
      const y = screenY(star.y);

      const radius = starRadius(star.magnitude);

      const safeName = escapeXml(star.name);

      const xText = star.x.toFixed(3);
      const yText = star.y.toFixed(3);

      /*
       * Keep labels slightly away from the star.
       */
      let labelX = x + 14;
      let labelY = y - 8;

      /*
       * If the label would go too far right,
       * place it on the other side.
       */
      if (labelX > width - 180) {
        labelX = x - 14;
        labelY = y - 8;
      }

      const textAnchor =
        labelX < x ? 'end' : 'start';

      return `
        <g class="face-star">
          <circle
            cx="${x}"
            cy="${y}"
            r="${radius}"
          />

          <text
            x="${labelX}"
            y="${labelY}"
            text-anchor="${textAnchor}"
            class="star-name"
          >${safeName}</text>

          <text
            x="${labelX}"
            y="${labelY + 18}"
            text-anchor="${textAnchor}"
            class="star-position"
          >(${xText}, ${yText})</text>
        </g>
      `;
    })
    .join('');

  /*
   * Draw axes.
   */
  const xAxisSvg = `
    <line
      x1="${axisLeft}"
      y1="${originY}"
      x2="${axisRight}"
      y2="${originY}"
      class="axis"
    />

    <polygon
      points="
        ${axisRight},${originY}
        ${axisRight - 12},${originY - 6}
        ${axisRight - 12},${originY + 6}
      "
      class="axis-arrow"
    />

    <polygon
      points="
        ${axisLeft},${originY}
        ${axisLeft + 12},${originY - 6}
        ${axisLeft + 12},${originY + 6}
      "
      class="axis-arrow"
    />
  `;

  const yAxisSvg = `
    <line
      x1="${originX}"
      y1="${axisBottom}"
      x2="${originX}"
      y2="${axisTop}"
      class="axis"
    />

    <polygon
      points="
        ${originX},${axisTop}
        ${originX - 6},${axisTop + 12}
        ${originX + 6},${axisTop + 12}
      "
      class="axis-arrow"
    />

    <polygon
      points="
        ${originX},${axisBottom}
        ${originX - 6},${axisBottom - 12}
        ${originX + 6},${axisBottom - 12}
      "
      class="axis-arrow"
    />
  `;

  /*
   * Scale bar.
   *
   * This is a visual 10 mm reference matching the
   * supplied reference image.
   *
   * If your model uses a known physical conversion,
   * replace this later with the real scale.
   */
  const scaleBarLength = 100;
  const scaleBarX = width - 190;
  const scaleBarY = height - 65;

  const scaleBarSvg = `
    <line
      x1="${scaleBarX}"
      y1="${scaleBarY}"
      x2="${scaleBarX + scaleBarLength}"
      y2="${scaleBarY}"
      class="scale-bar"
    />

    <line
      x1="${scaleBarX}"
      y1="${scaleBarY - 8}"
      x2="${scaleBarX}"
      y2="${scaleBarY + 8}"
      class="scale-bar"
    />

    <line
      x1="${scaleBarX + scaleBarLength}"
      y1="${scaleBarY - 8}"
      x2="${scaleBarX + scaleBarLength}"
      y2="${scaleBarY + 8}"
      class="scale-bar"
    />

    <text
      x="${scaleBarX + scaleBarLength / 2}"
      y="${scaleBarY + 35}"
      text-anchor="middle"
      class="scale-label"
    >10 mm</text>
  `;

  const polygonId =
    polygon.index !== undefined
      ? polygon.index
      : faceData.polygonId;

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${width} ${height}"
      class="face-svg"
    >

      <rect
        x="0"
        y="0"
        width="${width}"
        height="${height}"
        class="background"
      />

      <!-- Face boundary -->
      <polygon
        points="${polygonPoints}"
        class="face-boundary"
      />

      <!-- X axis -->
      ${xAxisSvg}

      <!-- Y axis -->
      ${yAxisSvg}

      <!-- Origin -->
      <circle
        cx="${originX}"
        cy="${originY}"
        r="5"
        class="origin"
      />

      <text
        x="${originX + 14}"
        y="${originY + 32}"
        class="origin-label"
      >(0,0) plate center</text>

      <text
        x="${axisRight - 10}"
        y="${originY - 15}"
        text-anchor="end"
        class="axis-label"
      >x (mm)</text>

      <text
        x="${originX + 15}"
        y="${axisTop + 20}"
        class="axis-label"
      >y (mm)</text>

      <!-- Stars -->
      ${starsSvg}

      <!-- Scale -->
      ${scaleBarSvg}

      <text
        x="35"
        y="45"
        class="face-title"
      >Face ${escapeXml(polygonId)}</text>

      <text
        x="35"
        y="72"
        class="face-subtitle"
      >${stars2D.length} star${stars2D.length === 1 ? '' : 's'}</text>

    </svg>
  `;
}

/**
 * Add CSS for the face view.
 */
function addStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');

  style.id = STYLE_ID;

  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      z-index: 99999;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;

      display: flex;
      align-items: center;
      justify-content: center;

      background: rgba(0, 0, 0, 0.75);

      padding: 30px;
      box-sizing: border-box;
    }

    #${OVERLAY_ID} .face-view-container {
      position: relative;

      width: min(1100px, 95vw);
      height: min(800px, 92vh);

      background: white;

      border-radius: 8px;

      box-shadow:
        0 20px 60px rgba(0, 0, 0, 0.35);

      overflow: hidden;
    }

    #${OVERLAY_ID} .face-view-svg-container {
      width: 100%;
      height: 100%;

      display: flex;
      align-items: center;
      justify-content: center;
    }

    #${OVERLAY_ID} .face-svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    #${OVERLAY_ID} .background {
      fill: #ffffff;
    }

    #${OVERLAY_ID} .face-boundary {
      fill: none;
      stroke: #c8c8c8;
      stroke-width: 1.5;
    }

    #${OVERLAY_ID} .axis {
      stroke: #999999;
      stroke-width: 1.2;
    }

    #${OVERLAY_ID} .axis-arrow {
      fill: #999999;
    }

    #${OVERLAY_ID} .origin {
      fill: #777777;
    }

    #${OVERLAY_ID} .axis-label {
      font-family: Arial, sans-serif;
      font-size: 18px;
      fill: #555555;
    }

    #${OVERLAY_ID} .origin-label {
      font-family: Arial, sans-serif;
      font-size: 17px;
      fill: #555555;
    }

    #${OVERLAY_ID} .face-star circle {
      fill: white;
      stroke: #a94e25;
      stroke-width: 2;
    }

    #${OVERLAY_ID} .star-name {
      font-family: Arial, sans-serif;
      font-size: 18px;
      font-weight: bold;
      fill: #111111;
    }

    #${OVERLAY_ID} .star-position {
      font-family: Arial, sans-serif;
      font-size: 11px;
      fill: #777777;
    }

    #${OVERLAY_ID} .face-title {
      font-family: Arial, sans-serif;
      font-size: 25px;
      font-weight: bold;
      fill: #111111;
    }

    #${OVERLAY_ID} .face-subtitle {
      font-family: Arial, sans-serif;
      font-size: 15px;
      fill: #666666;
    }

    #${OVERLAY_ID} .scale-bar {
      stroke: #555555;
      stroke-width: 1.5;
    }

    #${OVERLAY_ID} .scale-label {
      font-family: Arial, sans-serif;
      font-size: 16px;
      fill: #555555;
    }

    #${OVERLAY_ID} .face-view-close {
      position: absolute;

      right: 15px;
      top: 15px;

      width: 36px;
      height: 36px;

      border: none;
      border-radius: 50%;

      background: rgba(0, 0, 0, 0.08);

      font-size: 25px;
      line-height: 36px;

      cursor: pointer;

      z-index: 2;
    }

    #${OVERLAY_ID} .face-view-close:hover {
      background: rgba(0, 0, 0, 0.18);
    }
  `;

  document.head.appendChild(style);
}

/**
 * Display the selected face.
 */
export function showFaceView(faceData) {
  if (!faceData || !faceData.polygon) {
    return;
  }

  addStyles();

  const existing = document.getElementById(OVERLAY_ID);

  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');

  overlay.id = OVERLAY_ID;

  overlay.innerHTML = `
    <div class="face-view-container">

      <button
        class="face-view-close"
        type="button"
        aria-label="Close"
      >×</button>

      <div class="face-view-svg-container">
        ${createFaceSVG(faceData)}
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  const closeButton =
    overlay.querySelector('.face-view-close');

  closeButton.addEventListener('click', () => {
    overlay.remove();
  });

  // Close when clicking outside the white diagram.
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  // ESC closes the face view.
  const onKeyDown = event => {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener(
        'keydown',
        onKeyDown
      );
    }
  };

  document.addEventListener(
    'keydown',
    onKeyDown
  );
}

export function hideFaceView() {
  const overlay = document.getElementById(OVERLAY_ID);

  if (overlay) {
    overlay.remove();
  }
}