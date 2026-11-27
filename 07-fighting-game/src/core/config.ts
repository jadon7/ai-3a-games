// 全局常量。模拟固定 60 帧每秒，所有帧数表都按这个帧率写。
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

export const STAGE_HALF = 8.2;        // 场地半宽（米），角色脚底中心能到的最远处
export const MAX_SEPARATION = 7.6;    // 两人最远能拉开的距离，超过就被镜头边界拦住
export const GRAVITY = 30;            // 米每二次方秒，格斗游戏的跳跃要比真实重力干脆
export const BODY_HALF = 0.36;        // 推挤盒半宽（按身高 1.8 米算，角色各自再乘身高比例）

export const ROUND_TIME = 99;
export const ROUNDS_TO_WIN = 2;
export const MAX_HP = 1000;
export const MAX_METER = 100;
export const MAX_GUARD = 100;

export const INPUT_BUFFER = 9;        // 提前输入的宽限（帧）
export const PARRY_WINDOW = 7;        // 按下防御后的这几帧内挡住算“弹反”

export const QUALITY = {
  shadowMap: 2048,
  ao: true,
  bloom: true,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
};

export const DEBUG = new URLSearchParams(location.search);
