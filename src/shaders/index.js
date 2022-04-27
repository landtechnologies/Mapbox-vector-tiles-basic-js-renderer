// @flow

// readFileSync calls must be written out long-form for brfs.
/* eslint-disable prefer-template, no-path-concat */

const shaders: {[string]: {fragmentSource: string, vertexSource: string}} = {
    prelude: {
        fragmentSource: require('./_prelude.fragment.glsl').default,
        vertexSource: require( './_prelude.vertex.glsl').default
    },
    background: {
        fragmentSource: require('./background.fragment.glsl').default,
        vertexSource: require('./background.vertex.glsl').default
    },
    backgroundPattern: {
        fragmentSource: require('./background_pattern.fragment.glsl').default,
        vertexSource: require('./background_pattern.vertex.glsl').default
    },
    circle: {
        fragmentSource: require('./circle.fragment.glsl').default,
        vertexSource: require('./circle.vertex.glsl').default
    },
    clippingMask: {
        fragmentSource: require('./clipping_mask.fragment.glsl').default,
        vertexSource: require('./clipping_mask.vertex.glsl').default
    },
    heatmap: {
        fragmentSource: require('./heatmap.fragment.glsl').default,
        vertexSource: require('./heatmap.vertex.glsl').default
    },
    heatmapTexture: {
        fragmentSource: require('./heatmap_texture.fragment.glsl').default,
        vertexSource: require('./heatmap_texture.vertex.glsl').default
    },
    collisionBox: {
        fragmentSource: require('./collision_box.fragment.glsl').default,
        vertexSource: require('./collision_box.vertex.glsl').default
    },
    collisionCircle: {
        fragmentSource: require('./collision_circle.fragment.glsl').default,
        vertexSource: require('./collision_circle.vertex.glsl').default
    },
    debug: {
        fragmentSource: require('./debug.fragment.glsl').default,
        vertexSource: require('./debug.vertex.glsl').default
    },
    fill: {
        fragmentSource: require('./fill.fragment.glsl').default,
        vertexSource: require('./fill.vertex.glsl').default
    },
    fillOutline: {
        fragmentSource: require('./fill_outline.fragment.glsl').default,
        vertexSource: require('./fill_outline.vertex.glsl').default
    },
    fillOutlinePattern: {
        fragmentSource: require('./fill_outline_pattern.fragment.glsl').default,
        vertexSource: require('./fill_outline_pattern.vertex.glsl').default
    },
    fillPattern: {
        fragmentSource: require('./fill_pattern.fragment.glsl').default,
        vertexSource: require('./fill_pattern.vertex.glsl').default
    },
    fillExtrusion: {
        fragmentSource: require('./fill_extrusion.fragment.glsl').default,
        vertexSource: require('./fill_extrusion.vertex.glsl').default
    },
    fillExtrusionPattern: {
        fragmentSource: require('./fill_extrusion_pattern.fragment.glsl').default,
        vertexSource: require('./fill_extrusion_pattern.vertex.glsl').default
    },
    extrusionTexture: {
        fragmentSource: require('./extrusion_texture.fragment.glsl').default,
        vertexSource: require('./extrusion_texture.vertex.glsl').default
    },
    hillshadePrepare: {
        fragmentSource: require('./hillshade_prepare.fragment.glsl').default,
        vertexSource: require('./hillshade_prepare.vertex.glsl').default
    },
    hillshade: {
        fragmentSource: require('./hillshade.fragment.glsl').default,
        vertexSource: require('./hillshade.vertex.glsl').default
    },
    line: {
        fragmentSource: require('./line.fragment.glsl').default,
        vertexSource: require('./line.vertex.glsl').default
    },
    linePattern: {
        fragmentSource: require('./line_pattern.fragment.glsl').default,
        vertexSource: require('./line_pattern.vertex.glsl').default
    },
    lineSDF: {
        fragmentSource: require('./line_sdf.fragment.glsl').default,
        vertexSource: require('./line_sdf.vertex.glsl').default
    },
    raster: {
        fragmentSource: require('./raster.fragment.glsl').default,
        vertexSource: require('./raster.vertex.glsl').default
    },
    symbolIcon: {
        fragmentSource: require('./symbol_icon.fragment.glsl').default,
        vertexSource: require('./symbol_icon.vertex.glsl').default
    },
    symbolSDF: {
        fragmentSource: require('./symbol_sdf.fragment.glsl').default,
        vertexSource: require('./symbol_sdf.vertex.glsl').default
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
