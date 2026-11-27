import * as THREE from 'three';
import { MOON_DIR } from './sky';

/**
 * 环境贴图：一个只有渐变球和几块发光斑的小场景，PMREM 过一遍。
 * 上面是夜空的深蓝，下面是雪地反上来的冷灰，后上方一个月亮，两侧低处是火盆的暖光。
 * 角色的环境光和金属反射、湿石板的反光都靠它。
 */
export function createEnv(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMoon: { value: MOON_DIR.clone().setY(0.45).normalize() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoon; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float e = d.y;
        vec3 top = vec3(0.022, 0.034, 0.062), hor = vec3(0.07, 0.09, 0.125), bot = vec3(0.085, 0.095, 0.115);
        vec3 c = e > 0.0 ? mix(hor, top, pow(max(e, 0.0), 0.6)) : mix(hor, bot, pow(max(-e, 0.0), 0.5));
        float m = max(dot(d, uMoon), 0.0);
        c += vec3(0.7, 0.8, 1.0) * pow(max(m, 0.0), 90.0) * 9.0 + vec3(0.06, 0.08, 0.12) * pow(max(m, 0.0), 6.0);
        // 火盆：左右两侧、偏后、略低
        vec3 f1 = normalize(vec3(-0.75, 0.05, -0.55)), f2 = normalize(vec3(0.75, 0.05, -0.55));
        c += vec3(1.0, 0.42, 0.14) * (pow(max(dot(d, f1), 0.0), 14.0) + pow(max(dot(d, f2), 0.0), 14.0)) * 1.1;
        // 大殿的灯笼：正后方偏上
        vec3 l1 = normalize(vec3(-0.3, 0.3, -1.0)), l2 = normalize(vec3(0.3, 0.3, -1.0));
        // 宽而弱：尖锐的亮斑会在积水的镜面反射里变成抢眼的橙色圆斑（积水里的灯笼倒影交给平面反射）
        c += vec3(1.0, 0.25, 0.08) * (pow(max(dot(d, l1), 0.0), 24.0) + pow(max(dot(d, l2), 0.0), 24.0)) * 0.35;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
