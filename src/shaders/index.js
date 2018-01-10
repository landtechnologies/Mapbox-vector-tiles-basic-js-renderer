// @flow

// readFileSync calls must be written out long-form for brfs.
/* eslint-disable prefer-template, no-path-concat */

const shaders: {[string]: {fragmentSource: string, vertexSource: string}} = {
    prelude: {
        fragmentSource: require('./_prelude.fragment.glsl'),
        vertexSource: require( './_prelude.vertex.glsl')
    },
    background: {
        fragmentSource: require('./background.fragment.glsl'),
        vertexSource: require('./background.vertex.glsl')
    },
    backgroundPattern: {
        fragmentSource: require('./background_pattern.fragment.glsl'),
        vertexSource: require('./background_pattern.vertex.glsl')
    },
    circle: {
        fragmentSource: require('./circle.fragment.glsl'),
        vertexSource: require('./circle.vertex.glsl')
    },
    clippingMask: {
        fragmentSource: require('./clipping_mask.fragment.glsl'),
        vertexSource: require('./clipping_mask.vertex.glsl')
    },
    heatmap: {
        fragmentSource: require('./heatmap.fragment.glsl'),
        vertexSource: require('./heatmap.vertex.glsl')
    },
    heatmapTexture: {
        fragmentSource: require('./heatmap_texture.fragment.glsl'),
        vertexSource: require('./heatmap_texture.vertex.glsl')
    },
    collisionBox: {
        fragmentSource: require('./collision_box.fragment.glsl'),
        vertexSource: require('./collision_box.vertex.glsl')
    },
    collisionCircle: {
        fragmentSource: require('./collision_circle.fragment.glsl'),
        vertexSource: require('./collision_circle.vertex.glsl')
    },
    debug: {
        fragmentSource: require('./debug.fragment.glsl'),
        vertexSource: require('./debug.vertex.glsl')
    },
    fill: {
        fragmentSource: require('./fill.fragment.glsl'),
        vertexSource: require('./fill.vertex.glsl')
    },
    fillOutline: {
        fragmentSource: require('./fill_outline.fragment.glsl'),
        vertexSource: require('./fill_outline.vertex.glsl')
    },
    fillOutlinePattern: {
        fragmentSource: require('./fill_outline_pattern.fragment.glsl'),
        vertexSource: require('./fill_outline_pattern.vertex.glsl')
    },
    fillPattern: {
        fragmentSource: require('./fill_pattern.fragment.glsl'),
        vertexSource: require('./fill_pattern.vertex.glsl')
    },
    fillExtrusion: {
        fragmentSource: require('./fill_extrusion.fragment.glsl'),
        vertexSource: require('./fill_extrusion.vertex.glsl')
    },
    fillExtrusionPattern: {
        fragmentSource: require('./fill_extrusion_pattern.fragment.glsl'),
        vertexSource: require('./fill_extrusion_pattern.vertex.glsl')
    },
    extrusionTexture: {
        fragmentSource: require('./extrusion_texture.fragment.glsl'),
        vertexSource: require('./extrusion_texture.vertex.glsl')
    },
    hillshadePrepare: {
        fragmentSource: require('./hillshade_prepare.fragment.glsl'),
        vertexSource: require('./hillshade_prepare.vertex.glsl')
    },
    hillshade: {
        fragmentSource: require('./hillshade.fragment.glsl'),
        vertexSource: require('./hillshade.vertex.glsl')
    },
    line: {
        fragmentSource: require('./line.fragment.glsl'),
        vertexSource: require('./line.vertex.glsl')
    },
    linePattern: {
        fragmentSource: require('./line_pattern.fragment.glsl'),
        vertexSource: require('./line_pattern.vertex.glsl')
    },
    lineSDF: {
        fragmentSource: require('./line_sdf.fragment.glsl'),
        vertexSource: require('./line_sdf.vertex.glsl')
    },
    raster: {
        fragmentSource: require('./raster.fragment.glsl'),
        vertexSource: require('./raster.vertex.glsl')
    },
    symbolIcon: {
        fragmentSource: require('./symbol_icon.fragment.glsl'),
        vertexSource: require('./symbol_icon.vertex.glsl')
    },
    symbolSDF: {
        fragmentSource: require('./symbol_sdf.fragment.glsl'),
        vertexSource: require('./symbol_sdf.vertex.glsl')
    }
};

// Expand #pragmas to #ifdefs.

const re = /#pragma mapbox: ([\w]+) ([\w]+) ([\w]+) ([\w]+)/g;

for (const programName in shaders) {
    const program = shaders[programName];
    const fragmentPragmas: {[string]: boolean} = {};

    program.fragmentSource = program.fragmentSource.replace(re, (match: string, operation: string, precision: string, type: string, name: string) => {
        fragmentPragmas[name] = true;
        if (operation === 'define') {
            return `
#ifndef HAS_UNIFORM_u_${name}
varying ${precision} ${type} ${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
        } else /* if (operation === 'initialize') */ {
            return `
#ifdef HAS_UNIFORM_u_${name}
    ${precision} ${type} ${name} = u_${name};
#endif
`;
        }
    });

    program.vertexSource = program.vertexSource.replace(re, (match: string, operation: string, precision: string, type: string, name: string) => {
        const attrType = type === 'float' ? 'vec2' : 'vec4';
        if (fragmentPragmas[name]) {
            if (operation === 'define') {
                return `
#ifndef HAS_UNIFORM_u_${name}
uniform lowp float a_${name}_t;
attribute ${precision} ${attrType} a_${name};
varying ${precision} ${type} ${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
            } else /* if (operation === 'initialize') */ {
                return `
#ifndef HAS_UNIFORM_u_${name}
    ${name} = unpack_mix_${attrType}(a_${name}, a_${name}_t);
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
            }
        } else {
            if (operation === 'define') {
                return `
#ifndef HAS_UNIFORM_u_${name}
uniform lowp float a_${name}_t;
attribute ${precision} ${attrType} a_${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
            } else /* if (operation === 'initialize') */ {
                return `
#ifndef HAS_UNIFORM_u_${name}
    ${precision} ${type} ${name} = unpack_mix_${attrType}(a_${name}, a_${name}_t);
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
            }
        }
    });
}

module.exports = shaders;
