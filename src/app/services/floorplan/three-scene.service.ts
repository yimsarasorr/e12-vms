import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Injectable({
  providedIn: 'root'
})
export class ThreeSceneService {
  public scene!: THREE.Scene;
  public camera!: THREE.OrthographicCamera;
  public renderer!: THREE.WebGLRenderer;
  public controls!: OrbitControls;

  private coloredGroundPlane!: THREE.Mesh; // เพิ่ม Property นี้

  private frustumSize = 60;
  private canvas!: HTMLCanvasElement;
  private frameId: number | null = null;
  private onUpdateCallback: (() => void) | null = null;

  constructor(private ngZone: NgZone) { }

  /**
   * เริ่มต้นการตั้งค่า THREE.js ทั้งหมด
   * @param canvas Element ที่จะใช้ render
   */
  public initialize(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xEBF0F5);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.set(20, 18, 25);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, -6);
    
    // เพิ่มแสงพื้นฐาน
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    ambientLight.name = 'ambientLight';
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(-10, 20, -10);
    directionalLight.castShadow = true;
    directionalLight.name = 'directionalLight';
    this.scene.add(directionalLight);
    
    // Ground Plane (ย้ายมาจาก createScene เดิม)
    // const groundGeometry = new THREE.PlaneGeometry(100, 100);
    // const groundMaterial = new THREE.MeshStandardMaterial({
    //   color: 0xeeeeee,
    //   side: THREE.DoubleSide,
    // });
    
    // // แก้ไขตรงนี้: ลบ const แล้ว assign ให้กับ property ของ class
    // this.coloredGroundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    // this.coloredGroundPlane.rotation.x = -Math.PI / 2;
    // this.coloredGroundPlane.position.y = -0.01;
    // this.coloredGroundPlane.renderOrder = -1;
    // this.scene.add(this.coloredGroundPlane); // เพิ่ม this.

    // this.resize(); // ตั้งค่าขนาดเริ่มต้น
  }

  /**
   * เริ่มต้น Render Loop
   * @param onUpdate Callback function ที่จะถูกเรียกทุก frame (สำหรับ logic เช่น update player)
   */
  public startRenderingLoop(onUpdate: () => void): void {
    this.onUpdateCallback = onUpdate;
    
    this.ngZone.runOutsideAngular(() => {
      const render = () => {
        this.frameId = requestAnimationFrame(render);
        
        // เรียก callback ที่ component ส่งมา
        if (this.onUpdateCallback) {
          this.onUpdateCallback();
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      };
      render();
    });
  }

  /**
   * หยุด Render Loop
   */
  public stopRenderingLoop(): void {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.onUpdateCallback = null;
  }

  /**
   * จัดการการปรับขนาดหน้าจอ
   */
  public resize(): void {
    if (!this.renderer || !this.camera) return;

    const canvas = this.renderer.domElement;
    if (canvas.clientHeight > 0) {
      const needResize = canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight;
      if (needResize) {
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      }
      const aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.left = this.frustumSize * aspect / -2;
      this.camera.right = this.frustumSize * aspect / 2;
      this.camera.top = this.frustumSize / 2;
      this.camera.bottom = this.frustumSize / -2;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * อัปเดตสีของพื้นหลัง (Ground Plane)
   */
  public setGroundPlaneColor(color: THREE.Color | string | number): void {
    if (this.coloredGroundPlane) {
      (this.coloredGroundPlane.material as THREE.MeshStandardMaterial).color.set(color);
    }
  }

  /**
   * คืนค่าทรัพยากร
   */
  public destroy(): void {
    this.stopRenderingLoop();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.scene?.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((material: THREE.Material) => material.dispose());
        } else {
          object.material?.dispose();
        }
      }
    });
  }
}