import { Vector3 } from 'three'
import projections from './projections/async'
import { fourPointStar } from './shapes/star'
import circle from './shapes/circle'
import { loadStarCatalog, loadAsterismCatalog } from './database'

export { loadStarCatalog, loadAsterismCatalog }


// ============================================================
// FACE 11 / SCORPIUS PCB COORDINATE SETTINGS
// ============================================================

const FACE_INDEX = 11
const FACE_NAME = 'Scorpius'

// Required physical diameter of Face 11
const FACE_DIAMETER_CM = 5

// Therefore the required circumradius is 2.5 cm
const FACE_RADIUS_CM = FACE_DIAMETER_CM / 2


// ============================================================
// STAR ANGLE -> 3D VECTOR
// ============================================================

export function vectorFromAngles(theta, phi) {
  return new Vector3(
    Math.cos(phi) * Math.sin(theta),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(theta)
  ).normalize()
}


// ============================================================
// FACE 11 LOCAL COORDINATE SYSTEM
// ============================================================
//
// Coordinate system:
//
//              +Y
//              |
//              |
//              |
//              +-------- +X
//             (0,0)
//
// Origin = center of Face 11
//
// +Z = normal of Face 11
//
// X and Y are in the plane of the face.
//
// All X/Y values returned are in centimetres.
//
// The face is scaled so that:
//
//     Circumradius = 2.5 cm
//     Diameter      = 5.0 cm
//
// ============================================================

export function getFace11CoordinateSystem(topology) {

  const face = topology.polygons[FACE_INDEX]

  if (!face) {
    throw new Error(
      `Face ${FACE_INDEX} does not exist in this geometry.`
    )
  }

  // ----------------------------------------------------------
  // Face centre
  // ----------------------------------------------------------

  const center = face.center.clone()


  // ----------------------------------------------------------
  // Z axis
  //
  // Normal to the face
  // ----------------------------------------------------------

  const zAxis = face.plane.normal.clone().normalize()


  // ----------------------------------------------------------
  // X axis
  //
  // We use the direction from the face centre to the first
  // face vertex.
  //
  // This makes the coordinate system deterministic for the
  // current geometry.
  // ----------------------------------------------------------

  const xAxis = face.points[0]
    .clone()
    .sub(center)
    .normalize()


  // ----------------------------------------------------------
  // Y axis
  //
  // Cross product gives a vector perpendicular to both
  // Z and X and therefore lying in the face plane.
  // ----------------------------------------------------------

  const yAxis = zAxis
    .clone()
    .cross(xAxis)
    .normalize()


  // ----------------------------------------------------------
  // Calculate the ACTUAL circumradius from the face vertices.
  //
  // We do not assume a theoretical radius here.
  // ----------------------------------------------------------

  const circumradius = Math.max(
    ...face.points.map(point =>
      point.distanceTo(center)
    )
  )


  const diameter = circumradius * 2


  // ----------------------------------------------------------
  // Scale required to make the physical radius exactly
  // 2.5 cm.
  // ----------------------------------------------------------

  const scale = FACE_RADIUS_CM / circumradius


  return {
    face,
    center,
    xAxis,
    yAxis,
    zAxis,

    // Original geometry measurements
    circumradius,
    diameter,

    // Physical PCB measurements
    targetRadiusCm: FACE_RADIUS_CM,
    targetDiameterCm: FACE_DIAMETER_CM,

    // Geometry -> centimetres scale
    scale
  }
}


// ============================================================
// CONVERT A 3D POINT TO FACE 11 X/Y COORDINATES
// ============================================================

export function pointToFace11Coordinates(
  point,
  coordinateSystem
) {

  const {
    center,
    xAxis,
    yAxis,
    scale
  } = coordinateSystem


  // Vector from face centre to the star
  const relative = point.clone().sub(center)


  // Projection onto local X/Y axes
  const x = relative.dot(xAxis) * scale
  const y = relative.dot(yAxis) * scale


  return {
    x,
    y
  }
}


// ============================================================
// GET FACE 11 STAR COORDINATES
// ============================================================
//
// Returns all stars belonging to Face 11 with:
//
//     star
//     X coordinate in cm
//     Y coordinate in cm
//
// ============================================================

export function getFace11StarCoordinates(
  topology,
  projectedStars
) {

  const coordinateSystem =
    getFace11CoordinateSystem(topology)


  const face11Stars = []


  projectedStars.forEach(({ point, star }) => {

    // Find which polygon contains the projected star
    const face = topology.findContainingPolygon(point)


    // We only want Face 11
    if (!face || face.index !== FACE_INDEX) {
      return
    }


    const coordinates =
      pointToFace11Coordinates(
        point,
        coordinateSystem
      )


    face11Stars.push({

      id: star.id,

      name: star.name || `Star ${star.id}`,

      magnitude: star.magnitude,

      rightAscension: star.rightAscension,

      declination: star.declination,

      // PCB coordinates in centimetres
      x_cm: coordinates.x,

      y_cm: coordinates.y,

      // Keep original projected 3D point too
      point: point.clone()
    })
  })


  return {
    face: FACE_INDEX,
    faceName: FACE_NAME,

    diameter_cm: FACE_DIAMETER_CM,

    radius_cm: FACE_RADIUS_CM,

    center: coordinateSystem.center.clone(),

    xAxis: coordinateSystem.xAxis.clone(),

    yAxis: coordinateSystem.yAxis.clone(),

    zAxis: coordinateSystem.zAxis.clone(),

    stars: face11Stars
  }
}


// ============================================================
// PRINT FACE 11 STAR COORDINATES TO CONSOLE
// ============================================================

export function printFace11StarCoordinates(
  topology,
  projectedStars
) {

  const result =
    getFace11StarCoordinates(
      topology,
      projectedStars
    )


  console.log(
    '============================================'
  )

  console.log(
    'FACE 11 - SCORPIUS PCB COORDINATES'
  )

  console.log(
    '============================================'
  )

  console.log(
    `Face diameter : ${result.diameter_cm} cm`
  )

  console.log(
    `Face radius   : ${result.radius_cm} cm`
  )

  console.log(
    `Number of stars: ${result.stars.length}`
  )

  console.log(
    '--------------------------------------------'
  )


  console.table(
    result.stars.map(star => ({
      ID: star.id,
      Name: star.name,
      Magnitude: star.magnitude,
      X_cm: Number(star.x_cm.toFixed(4)),
      Y_cm: Number(star.y_cm.toFixed(4))
    }))
  )


  console.log(
    '============================================'
  )


  return result
}


// ============================================================
// CREATE CSV FOR PCB DESIGN
// ============================================================

export function face11StarsToCSV(
  topology,
  projectedStars
) {

  const result =
    getFace11StarCoordinates(
      topology,
      projectedStars
    )


  const header =
    'Star_ID,Star_Name,Magnitude,X_cm,Y_cm,Right_Ascension,Declination'


  const rows = result.stars.map(star => {

    const name =
      String(star.name)
        .replace(/"/g, '""')


    return [
      star.id,
      `"${name}"`,
      star.magnitude,
      star.x_cm.toFixed(4),
      star.y_cm.toFixed(4),
      star.rightAscension,
      star.declination
    ].join(',')
  })


  return [
    header,
    ...rows
  ].join('\n')
}


// ============================================================
// DOWNLOAD FACE 11 CSV
// ============================================================

export function downloadFace11CSV(
  topology,
  projectedStars
) {

  const csv =
    face11StarsToCSV(
      topology,
      projectedStars
    )


  const blob =
    new Blob(
      [csv],
      {
        type: 'text/csv;charset=utf-8;'
      }
    )


  const url =
    URL.createObjectURL(blob)


  const link =
    document.createElement('a')


  link.href = url

  link.download =
    'face11_scorpius_pcb_coordinates.csv'


  document.body.appendChild(link)

  link.click()

  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}


// ============================================================
// PROJECTED SPHERE STARS
// ============================================================

export const getProjectedSphereStars = starQuery => {

  return loadStarCatalog(starQuery).then(stars => {

    return stars.map(star => {

      const direction =
        vectorFromAngles(
          star.rightAscension,
          star.declination
        )


      return {
        point: direction.clone().multiplyScalar(1.01),
        star
      }
    })
  })
}


// ============================================================
// PROJECT STARS
// ============================================================

export const getProjectedStars = (
  topology,
  starQuery,
  asterismQuery
) => (

  Promise.all([

    loadStarCatalog(starQuery),

    loadAsterismCatalog(asterismQuery)

  ])

  .then(([stars, asterisms]) => {


    // --------------------------------------------------------
    // Find all stars connected by an asterism
    // --------------------------------------------------------

    const connectedStars = [
      ...new Set(
        [].concat(
          ...asterisms.map(a => a.stars)
        )
      )
    ]


    stars.forEach(star => {

      Object.assign(
        star,
        {
          connected:
            connectedStars.indexOf(star.id) > -1
        }
      )

    })


    // --------------------------------------------------------
    // Project stars onto the geometry
    // --------------------------------------------------------

    return projectStars(
      topology,
      stars
    )

    .then(projectedStars => {


      // ======================================================
      // FACE 11 / SCORPIUS EXTRACTION
      // ======================================================
      //
      // This does NOT modify the existing projected stars.
      //
      // It simply calculates the PCB coordinates and prints
      // them to the browser console.
      //
      // ======================================================

      try {

        printFace11StarCoordinates(
          topology,
          projectedStars
        )

      } catch (error) {

        // Some geometries may not have Face 11.
        console.warn(
          'Face 11 coordinates unavailable:',
          error.message
        )

      }


      // ------------------------------------------------------
      // Continue existing asterism processing
      // ------------------------------------------------------

      return projectAsterisms(
        topology,
        projectedStars,
        asterisms
      )

      .then(asterisms => ({

        stars: projectedStars,

        asterisms

      }))

    })

  })
)


// ============================================================
// PROJECT STARS ONTO GEOMETRY
// ============================================================

const scaleFromArc = (
  arc,
  distance
) => {

  return distance *
    Math.tan(
      Math.PI * arc / 180
    )
}


const projectStars = (
  topology,
  stars
) => (

  Promise.all(

    stars.map(star => {

      const {
        rightAscension,
        declination
      } = star


      const direction =
        vectorFromAngles(
          rightAscension,
          declination
        )


      return projections.vector(
        topology,
        direction
      )

      .then(({ point }) => {


        // ----------------------------------------------------
        // Determine which polygon contains the star
        // ----------------------------------------------------

        const face =
          topology.findContainingPolygon(point)


        // ----------------------------------------------------
        // Calculate PCB coordinates ONLY for Face 11
        // ----------------------------------------------------

        let pcbCoordinates = null


        if (
          face &&
          face.index === FACE_INDEX
        ) {

          try {

            const coordinateSystem =
              getFace11CoordinateSystem(
                topology
              )


            pcbCoordinates =
              pointToFace11Coordinates(
                point,
                coordinateSystem
              )

          } catch (error) {

            console.warn(
              'Could not calculate Face 11 coordinates:',
              error
            )

          }

        }


        // ----------------------------------------------------
        // Existing star shape logic
        // ----------------------------------------------------

        const shape =
          star.magnitude < 2 ||
          star.connected

            ? fourPointStar

            : circle


        const arc =
          (13 - star.magnitude) / 15 *
          .2864 +
          .4774


        const scale =
          scaleFromArc(
            arc,
            point.length()
          )


        const angle =
          star.id %
          (2 * Math.PI)


        return projections.path(
          topology,
          shape,
          direction,
          {
            scale,
            angle
          }
        )

        .then(paths => ({

          paths,

          point,

          star,

          // --------------------------------------------------
          // New PCB coordinate information
          // --------------------------------------------------

          polygonId:
            face
              ? face.index
              : null,

          pcbCoordinates

        }))

      })

    })

  )
)


// ============================================================
// PROJECT ASTERISMS
// ============================================================

const projectAsterisms = (
  topology,
  projectedStars,
  asterisms
) => (

  Promise.all(

    asterisms.map(asterism => {

      const pairs =
        asterism.stars

          .map(id =>
            projectedStars.find(
              s => s.star.id === id
            ).point
          )

          .reduce(
            makePairs,
            []
          )


      return Promise.all(

        pairs.map(pair =>
          projectAsterismLine(
            topology,
            pair
          )
        )

      )

      .then(
        segments =>
          [].concat(...segments)
      )

      .then(
        segments =>
          segments.map(
            segment =>
              Object.assign(
                { asterism },
                segment
              )
          )
      )

    })

  )

  .then(
    segments =>
      [].concat(...segments)
  )
)


// ============================================================
// PROJECT ASTERISM LINE
// ============================================================

const projectAsterismLine = (
  topology,
  pair
) => (

  projections.line(
    topology,
    ...pair
  )

  .then(segments => {

    segments.forEach(segment => {

      segment.edge =
        segment.edge.map(
          p => p.clone()
        )


      const [a, b] =
        segment.edge


      const [a_, b_] =
        [a, b].map(
          p => p.clone()
        )


      const length =
        a.distanceTo(b)


      const STAR_OFFSET =
        .0225 / length


      const EDGE_OFFSET =
        .015 / length


      const QUAD_ARC =
        .32


      const QUAD_THICKNESS =
        scaleFromArc(
          QUAD_ARC,
          a.length()
        )


      const aLerpDist =
        pair.some(
          star => a_.equals(star)
        )

          ? STAR_OFFSET
          : EDGE_OFFSET


      const bLerpDist =
        pair.some(
          star => b_.equals(star)
        )

          ? STAR_OFFSET
          : EDGE_OFFSET


      if (
        Math.max(
          aLerpDist,
          bLerpDist
        ) > .5
      ) {
        return
      }


      const polygon =
        topology.polygons[
          segment.polygonId
        ]


      const cross =
        polygon.plane.normal

          .clone()

          .cross(
            b.clone().sub(a)
          )

          .normalize()

          .multiplyScalar(
            QUAD_THICKNESS / 2
          )


      a.lerp(
        b_,
        aLerpDist,
        .5
      )


      b.lerp(
        a_,
        bLerpDist,
        .5
      )


      segment.quad = ([

        a.clone().add(cross),

        a.clone().sub(cross),

        b.clone().sub(cross),

        b.clone().add(cross)

      ])

      .reduce(
        makeSequence,
        []
      )

      .reduce(
        makePairs,
        []
      )

      .reduce(
        (a, b) =>
          a.concat(b)
      )

    })


    return segments.filter(
      segment =>
        segment.quad
    )

  })
)


// ============================================================
// HELPER FUNCTIONS
// ============================================================

const makePairs = (
  result,
  value,
  index,
  array
) => {

  if (index % 2 === 0) {

    result.push([])

  }

  result[result.length - 1].push(value)

  return result
}


const makeSequence = (
  result,
  value
) => {

  result.push(value)

  return result
}