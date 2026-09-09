import * as three from 'three';
import Topology from './topology'
import {
  getProjectedStars,
  getProjectedSphereStars,
  loadStarCatalog,
  loadAsterismCatalog,
  vectorFromAngles
} from './catalogs'
import {constructHierarchicalMesh} from './geometry/hierarchical-mesh';
import './extensions/curve-path'
import { drawSVG } from './template'
import { drawSphereSVG } from './sphere-svg'

function o(constructor, props, children=[]) {
  let node = Object.assign(new constructor, props);

  children = [].concat(children);
  if (children.length) {
    node.add(...children);
  }

  return node;
}



// export default function project(polyhedron, starQuery, asterismQuery, netOptions) {
//   const topology = new Topology(polyhedron)

export default function project(polyhedron, starQuery, asterismQuery, netOptions) {

  console.log('PROJECT GEOMETRY:', polyhedron);
console.log('IS SPHERE:', polyhedron.userData && polyhedron.userData.isSphere);


  if (polyhedron.userData && polyhedron.userData.isSphere) {
    return projectSphere(
      polyhedron,
      starQuery,
      asterismQuery
    );
  }

  const topology = new Topology(polyhedron)
  return getProjectedStars(
    topology,
    starQuery,
    asterismQuery
  ).then(({stars, asterisms}) => (
    build(
      topology,
      stars,
      asterisms,
      netOptions
    )
  ))
}

// const projectSphere = (sphereGeometry, starQuery, asterismQuery) => {
//   return Promise.all([
//     getProjectedSphereStars(starQuery),
//     getSphereAsterisms(asterismQuery)
//   ]).then(([stars, asterisms]) => {
//     const object = new three.Object3D();

//     // Sphere surface
//     const sphere = o(
//       three.Mesh,
//       {
//         userData: {
//           className: 'poly-face'
//         },
//         geometry: sphereGeometry
//       }
//     );

//     object.add(sphere);

//     // Stars
//     object.add(
//       starPointsObject(
//         stars.map(s => ({
//           point: s.point
//         }))
//       )
//     );

//     // Asterism lines
//     object.add(
//       asterismLinesObject(
//         asterisms
//       )
//     );

//     return object;
//   });
// };

const projectSphere = (sphereGeometry, starQuery, asterismQuery) => {
  return Promise.all([
    loadStarCatalog(starQuery),
    loadAsterismCatalog(asterismQuery)
  ]).then(([stars, asterisms]) => {

    const projectedStars = stars.map(star => ({
      point: vectorFromAngles(
        star.rightAscension,
        star.declination
      ).multiplyScalar(1.01),
      star
    }));

    const projectedAsterisms = {};

    asterisms.forEach(asterism => {
      projectedAsterisms[asterism.name] = [];

      for (let i = 0; i < asterism.stars.length - 1; i++) {
        const a = projectedStars.find(
          s => s.star.id === asterism.stars[i]
        );

        const b = projectedStars.find(
          s => s.star.id === asterism.stars[i + 1]
        );

        if (!a || !b) continue;

        projectedAsterisms[asterism.name].push(
          a.point.clone(),
          b.point.clone()
        );
      }
    });

    const object = new three.Object3D();

    object.add(
      o(three.Mesh, {
        userData: {
          className: 'poly-face'
        },
        geometry: sphereGeometry
      })
    );

    object.add(
      starPointsObject(projectedStars)
    );

    object.add(
      asterismLinesObject(projectedAsterisms)
    );
 generateRenderButton(() => {
  drawSphereSVG(
    projectedStars,
    projectedAsterisms
  );
});
    return object;
  });
};
const build = (topology, projectedStars, projectedAsterisms, netOptions) => {
  let hierarchicalMesh = constructHierarchicalMesh(topology);
  let objectByPolygon = {};

  /// before getting started, fill in some containers for each polygon in the
  /// hierarchical mesh.
  hierarchicalMesh.traverse(obj => {
    let node = obj.userData.node;
    if (!node) return;

    // now for anything related to a polygon we can lookup the matrix transform
    objectByPolygon[node.poly.index] = obj;
  });

  /// Project edge and cut lines
  let projectedEdges = topology.polygons.map(polygon => {
    const polygonId = polygon.index
    let obj = objectByPolygon[polygon.index],
      node = obj.userData.node,
      parent = obj.userData.parent,
      children = obj.userData.children;

    let fold = parent && [node.edge.line.start, node.edge.line.end];
    let cuts = node.poly.edges
      .filter(e => (
        (!parent || e.shared.poly !== parent.poly)
        && children.every(c => c.node.edge.id !== e.id)
      ))
      .map(({line}) => ([line.start, line.end]));

    return {polygonId, fold, cuts};
  });

  hierarchicalMesh.traverse(obj => {
    const polygon = obj.userData.node && obj.userData.node.poly;
    const polygonId = polygon && polygon.index
    if (!polygon) return;

    let points = projectedStars.filter(s => s.polygonId === polygonId),
      {fold, cuts} = projectedEdges.find(e => e.polygonId === polygonId),
      asterisms = projectedAsterisms
        .filter(a => a.polygonId === polygonId)
        .reduce((map, {asterism, quad}) => {
          if (!map[asterism.name]) map[asterism.name] = [];
          map[asterism.name].push(quad);
          return map;
        }, {});

    const starPaths = projectedStars.reduce((paths, star) => {
      if (!star.paths) return paths
      paths.push(...star.paths.filter(path => path.polygonId === polygonId))

      return paths
    }, [])

    obj.add(
      polyFaceObject(polygon),
      fold && polyFoldLinesObject(fold) || o(three.Object3D),
      polyCutLinesObject(cuts),
      starPointsObject(points),
      starLinesObject(starPaths),
      asterismLinesObject(asterisms)
    );
  });

  // Pick the "top" polygon and rotate so that it faces -Z
  let back = new three.Vector3(0, 0, 1)
  let top = hierarchicalMesh.children[0].userData.node.poly,
    angle = top.plane.normal.angleTo(back),
    cross = new three.Vector3().crossVectors(top.plane.normal, back).normalize(),
    rotation = new three.Matrix4().makeRotationAxis(cross, angle)

  // Update the object's matrix with this new transform
  hierarchicalMesh.updateMatrixWorld()

  // Collect each polygon's matrix and fold/cut edges
  const polygons = topology.polygons.map(polygon => {
    const object = objectByPolygon[polygon.index]
    object.updateMatrixWorld()
    const matrix = rotation.clone().multiply(object.matrixWorld.clone())
    const { node, parent, children } = object.userData

    const fold = parent && node.edge
    const cuts = node.poly.edges
      .filter(e => (
        (!parent || e.shared.poly !== parent.poly)
        && children.every(c => c.node.edge.id !== e.id)
      ))

    return {
      polygon,
      normal: polygon.plane.normal.clone().applyMatrix4(rotation),
      matrix,
      fold,
      cuts
    }
  })

  generateRenderButton(() => {
    // Render flattened SVG
    drawSVG(polygons, projectedStars, projectedAsterisms, netOptions)
  })

  



  return hierarchicalMesh
}

const generateRenderButton = action => {
  const existing = document.querySelector('#draw-svg')
  if (existing) {
    existing.parentNode.removeChild(existing)
  }

const button = document.createElement('button')
button.id = 'draw-svg';
button.addEventListener('click', action)
  button.textContent = 'Draw SVG'
  button.style.position = 'absolute'
  button.style.width = '90px'
  button.style.margin = '2px'
  button.style.top = '20px'
  button.style.right = '20px'


  document.querySelector('#preview').appendChild(button)
}

// const generateDXFButton = action => {
//   const existing = document.querySelector('#draw-dxf')
//   if (existing) {
//     existing.parentNode.removeChild(existing)
//   }

//   const button = document.createElement('button')
//   button.id = 'draw-dxf'
//   button.addEventListener('click', action)
//   button.textContent = 'Draw DXF'
//   button.style.position = 'absolute'
//   button.style.width = '90px'
//   button.style.margin = '2px'
//   button.style.top = '50px'
//   button.style.right = '20px'

//   document.querySelector('#preview').appendChild(button)
// }

const starPointsObject = points => o(
  three.Points, {
    name: 'stars',
    userData: {className: 'stars'},
    geometry: o(
      three.Geometry,
      { vertices: points.map(s => s.point) }
    )
  }
)

const starLinesObject = paths => o(
  three.LineSegments, {
    userData: {type: 'star', className: 'star shape'},
    geometry: o(
      three.Geometry, {
        vertices: [].concat(
          ...paths.map(path => path.getLineSegments(10))
        )
      }
    )
  }
)

const polyFaceObject = polygon => o(
  three.Mesh, {
    userData: {className: 'poly-face'},
    geometry: o(three.Geometry, {
      vertices: polygon.points.slice(),
      faces: polygon.triangles.map(({a, b, c}) => (
        new three.Face3(
          ...[a,b,c]
            .map(v => polygon.points.indexOf(v))
        )
      ))
    })
  }
)

const asterismLinesObject = asterisms => o(
  three.Object3D,
  {name: 'asterisms'},
  Object.keys(asterisms).map(name =>
    o(three.LineSegments, {
      name: `asterism-${name}`,
      userData: {
        asterism: {name},
        className: 'asterism'
      },
      geometry: o(three.Geometry, {
        vertices: [].concat(...asterisms[name])
      })
    })
  )
)

const polyFoldLinesObject = fold => o(
  three.LineSegments, {
    userData: {className: 'fold'},
    geometry: o(three.Geometry, {vertices: fold})
  }
)

const polyCutLinesObject = cuts => o(
  three.LineSegments, {
    userData: {className: 'cut'},
    geometry: o(three.Geometry, {
      vertices: [].concat(...cuts)
    })
  }
)
