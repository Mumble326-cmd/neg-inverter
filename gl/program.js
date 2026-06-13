// gl/program.js — compile shaders, link program, look up locations

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + err);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link error: ' + err);
  }
  return program;
}

function getLocations(gl, program) {
  return {
    a_position: gl.getAttribLocation(program,  'a_position'),
    a_texCoord: gl.getAttribLocation(program,  'a_texCoord'),
    u_image:    gl.getUniformLocation(program, 'u_image'),
    u_flatField:        gl.getUniformLocation(program, 'u_flatField'),
    u_flatFieldStrength:gl.getUniformLocation(program, 'u_flatFieldStrength'),
    u_filmBase: gl.getUniformLocation(program, 'u_filmBase'),
    u_density:  gl.getUniformLocation(program, 'u_density'),
    u_exposure: gl.getUniformLocation(program, 'u_exposure'),
    u_zoom:     gl.getUniformLocation(program, 'u_zoom'),
  };
}
