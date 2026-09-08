const header = `0
SECTION
2
HEADER
0
ENDSEC
0
SECTION
2
ENTITIES
`

const footer = `0
ENDSEC
0
EOF
`

const lineEntity = (a, b) => `0
LINE
8
0
10
${a.x}
20
${-a.y}
30
0
11
${b.x}
21
${-b.y}
31
0
`

const addLines = (result, lines) => {
  lines.forEach(line => {
    if (line.length >= 2) {
      result += lineEntity(line[0], line[1])
    }
  })

  return result
}

export function createDXF(cuts, folds, asterisms, tabs) {
  let dxf = header

  // Cut lines
  dxf = addLines(dxf, cuts)

  // Fold lines
  dxf = addLines(dxf, folds)

  // Constellation / asterism lines
  asterisms.forEach(line => {
    const points = line.toPoints()

    if (points.length >= 2) {
      dxf += lineEntity(points[0], points[1])
    }
  })

  // Tab outlines
  tabs.forEach(tab => {
    const points = tab.quad

    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]

      dxf += lineEntity(a, b)
    }
  })

  dxf += footer

  return dxf
}