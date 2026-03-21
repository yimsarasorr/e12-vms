import { Component, ElementRef, ViewChild, AfterViewInit, HostListener, Output, EventEmitter, Input, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'; // <--- 1. Import เข้ามา

// --- เชื่อมต่อ Library ให้ถูกต้อง ---
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

@Component({
  selector: 'app-building-view',
  standalone: true,
  imports: [],
  templateUrl: './building-view.component.html',
  styleUrls: ['./building-view.component.css']
})
export class BuildingViewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvasBuilding') private canvasRef!: ElementRef;
  @Output() floorSelected = new EventEmitter<number>();
  @Input() floors: any[] = [];
  @Input() activeFloor: number | null = null;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private clickableFloors: THREE.Mesh[] = [];
  private floorOverlays: THREE.Mesh[] = [];
  private floorLabels: any[] = []; // เปลี่ยน type จาก THREE.Sprite[] เป็น any[] (หรือ THREE.Object3D[])
  private resizeObserver?: ResizeObserver;

  private floorColors: string[] = [
    '#f94144', '#f3722c', '#f8961e', '#f9844a', '#f9c74f', '#90be6d',
    '#43aa8b', '#4d908e', '#577590', '#277da1', '#a855f7', '#ef476f'
  ];

  ngAfterViewInit(): void {
    this.createScene();
    this.createBuildingModel();
    this.resizeRenderer();
    this.startRenderingLoop();

    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resizeRenderer());
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeFloor'] && this.floorOverlays.length > 0) {
      this.updateFloorHighlights();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private get canvas(): HTMLCanvasElement {
    return this.canvasRef.nativeElement;
  }

  private createScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xEBF0F5);

    this.camera = new THREE.PerspectiveCamera(50, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 1000);
    this.camera.position.set(80, 60, 80);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 20, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(50, 100, 25);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.resizeRenderer();
  }

  private resizeRenderer(): void {
    if (!this.renderer || !this.camera) {
      return;
    }

    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? this.canvas.clientWidth;
    const height = parent?.clientHeight ?? this.canvas.clientHeight;

    if (!width || !height) {
      return;
    }

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // --- 2. สร้างฟังก์ชันสำหรับรวม Geometry ของหน้าต่าง ---
  private createMergedWindowMesh(totalFloors: number, floorHeight: number, wingDepth: number, coreWidth: number, coreDepth: number, material: THREE.Material): THREE.Mesh {
    const windowGeometries: THREE.BufferGeometry[] = [];
    const windowHeight = floorHeight * 0.7;
    const windowWidth = 2.5;
    const smallGap = 0.5;
    const largeGap = 4.0;
    const zOffset = 0.1;

    const baseWindowGeo = new THREE.PlaneGeometry(windowWidth, windowHeight);

    for (let i = 0; i < totalFloors; i++) {
      const yPos = i * floorHeight + floorHeight / 2;

      const createWindows = (startX: number, count: number, direction: number, z: number) => {
        for (let j = 0; j < count; j++) {
          const geo = baseWindowGeo.clone();
          const x = startX + direction * ((windowWidth / 2) + (j * (windowWidth + smallGap)));
          geo.translate(x, yPos, z);
          windowGeometries.push(geo);
        }
      };

      // -- Pattern 2-3-2 (ด้านหน้า, ปีกซ้าย) --
      let currentX_left = -coreWidth / 2 - largeGap;
      createWindows(currentX_left, 2, -1, wingDepth / 2 + zOffset);

      currentX_left -= (2 * windowWidth + 1 * smallGap + largeGap);
      createWindows(currentX_left, 3, -1, wingDepth / 2 + zOffset);

      currentX_left -= (3 * windowWidth + 2 * smallGap + largeGap);
      createWindows(currentX_left, 2, -1, wingDepth / 2 + zOffset);

      // -- Pattern 2-3-2 (ด้านหน้า, ปีกขวา) --
      let currentX_right = coreWidth / 2 + largeGap;
      createWindows(currentX_right, 2, 1, wingDepth / 2 + zOffset);

      currentX_right += (2 * windowWidth + 1 * smallGap + largeGap);
      createWindows(currentX_right, 3, 1, wingDepth / 2 + zOffset);

      currentX_right += (3 * windowWidth + 2 * smallGap + largeGap);
      createWindows(currentX_right, 2, 1, wingDepth / 2 + zOffset);

      // -- Pattern Lobby 3 (ด้านหน้า) --
      const lobbyStartX = -(windowWidth + smallGap);
      for (let j = 0; j < 3; j++) {
        const geo = baseWindowGeo.clone();
        const x = lobbyStartX + (j * (windowWidth + smallGap));
        geo.translate(x, yPos, coreDepth / 2 + zOffset);
        windowGeometries.push(geo);
      }
    }

    baseWindowGeo.dispose(); // คืน Memory

    if (windowGeometries.length === 0) {
      return new THREE.Mesh(); // Return empty mesh if no windows
    }

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(windowGeometries);
    return new THREE.Mesh(mergedGeometry, material);
  }

  private createBuildingModel(): void {
    const textureLoader = new THREE.TextureLoader();
    const mainMaterial = new THREE.MeshStandardMaterial({ color: 0xEAE0D5 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x4B4B4B });
    const windowTexture = textureLoader.load('assets/window-texture.png');
    const windowMaterial = new THREE.MeshBasicMaterial({ map: windowTexture, transparent: true });

    const floorHeight = 3.5;
    const totalFloors = this.floors?.length || 12;
    const buildingHeight = totalFloors * floorHeight;
    const wingWidth = 40;
    const wingDepth = 18;
    const coreWidth = 14;
    const coreDepth = 20;

    // --- สร้างโครงสร้างหลักของตึก (ไม่รวมหน้าต่าง) ---
    const buildingStructureGroup = new THREE.Group();
    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, buildingHeight, wingDepth), mainMaterial);
    leftWing.position.set(-(wingWidth / 2 + coreWidth / 2), buildingHeight / 2, 0);
    buildingStructureGroup.add(leftWing);

    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, buildingHeight, wingDepth), mainMaterial);
    rightWing.position.set(wingWidth / 2 + coreWidth / 2, buildingHeight / 2, 0);
    buildingStructureGroup.add(rightWing);

    const core = new THREE.Mesh(new THREE.BoxGeometry(coreWidth, buildingHeight, coreDepth), accentMaterial);
    core.position.set(0, buildingHeight / 2, -(coreDepth - wingDepth) / 2);
    buildingStructureGroup.add(core);

    const rooftopGeo = new THREE.BoxGeometry(10, 4, 15);
    const rooftopStructure = new THREE.Mesh(rooftopGeo, mainMaterial);
    rooftopStructure.position.set(0, buildingHeight + 2, 0);
    buildingStructureGroup.add(rooftopStructure);

    this.scene.add(buildingStructureGroup);

    // --- 3. เรียกใช้ฟังก์ชันใหม่เพื่อสร้างหน้าต่างทั้งหมดใน Mesh เดียว ---
    const allWindowsMesh = this.createMergedWindowMesh(totalFloors, floorHeight, wingDepth, coreWidth, coreDepth, windowMaterial);
    this.scene.add(allWindowsMesh);

    // --- ส่วนที่ต้องแก้คือ Loop นี้ครับ ---
    const clickBoxWidth = wingWidth * 2 + coreWidth;

    for (let i = 1; i <= totalFloors; i++) {
      // ดึงสีส่งตรงมาจาก Database ได้เลย
      const color = this.floors?.[i - 1]?.color || this.floorColors[(i - 1) % this.floorColors.length];

      const overlayMaterial = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      const floorBoxGeo = new THREE.BoxGeometry(clickBoxWidth, floorHeight, coreDepth + 1);
      const floorOverlay = new THREE.Mesh(floorBoxGeo, overlayMaterial);
      floorOverlay.position.set(0, (i - 1) * floorHeight + floorHeight / 2, 0);
      floorOverlay.userData = { floor: i };
      floorOverlay.renderOrder = 1;
      this.clickableFloors.push(floorOverlay);
      this.floorOverlays.push(floorOverlay);
      this.scene.add(floorOverlay);

      // --- [จุดที่แก้ไข] เปลี่ยนจาก Sprite เป็น Mesh ---
      const labelMesh = this.createFloorLabelMesh(i);
      labelMesh.position.set(
        -(wingWidth / 2 + coreWidth / 2) - 4,
        (i - 1) * floorHeight + floorHeight / 2,
        wingDepth / 2 + 3
      );
      // labelMesh.renderOrder = 2; // ถ้าต้องการให้วาดทับ overlay
      this.floorLabels.push(labelMesh);
      this.scene.add(labelMesh);
    }

    this.updateFloorHighlights();
  }

  @HostListener('window:click', ['$event'])
  onClick(event: MouseEvent) {
    if (!this.renderer || event.target !== this.renderer.domElement) {
      return;
    }
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const rect = this.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObjects(this.clickableFloors);
    if (intersects.length > 0) {
      const clickedFloor = intersects[0].object;
      const floorNumber = clickedFloor.userData['floor'];
      this.floorSelected.emit(floorNumber);
      // this.activeFloor = floorNumber;
      // this.updateFloorHighlights();
    }
  }

  private updateFloorHighlights(): void {
    if (!this.floorOverlays.length) return;
    this.floorOverlays.forEach((mesh, index) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const isActive = this.activeFloor === index + 1;
      material.opacity = isActive ? 0.85 : 0.55;
      material.emissive = new THREE.Color(isActive ? '#ffffff' : '#000000');
      material.emissiveIntensity = isActive ? 0.2 : 0.0;
    });

    this.floorLabels.forEach((label, index) => {
      label.material.opacity = this.activeFloor ? (this.activeFloor === index + 1 ? 1 : 0.4) : 0.8;
    });
  }

  private createFloorLabelMesh(floorNumber: number): THREE.Mesh {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;

    // --- จุดแก้ที่ 1: ปรับสีพื้นวงกลมให้ทึบ 100% (จาก 0.9 เป็น 1.0 หรือใช้ Hex เลย) ---
    context.fillStyle = '#ffffff'; // สีขาวทึบ (ไม่เอา rgba แบบมี transparency แล้ว)
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    context.fill();

    // ส่วนวาดตัวเลข (เหมือนเดิม)
    context.fillStyle = '#1f2933';
    context.font = 'bold 52px "Inter", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(floorNumber.toString(), size / 2, size / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);

    // --- จุดแก้ที่ 2: เพิ่ม alphaTest ใน Material ---
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,  // ต้องเปิดไว้เพื่อให้ตัดขอบได้
      side: THREE.DoubleSide,

      // เพิ่มบรรทัดนี้ครับ! สำคัญมาก
      alphaTest: 0.5,     // ค่านี้จะตัดส่วนที่ใสทิ้งไปเลย ส่วนที่เหลือจะทึบแสง 100% ไม่มีการดูดสีข้างหลัง

      // เอา depthWrite: false ออก (หรือปรับเป็น true) เพื่อให้มันบังวัตถุข้างหลังได้มิด
      depthWrite: true
    });

    const geometry = new THREE.PlaneGeometry(6, 6); // หรือขนาดเดิมที่คุณใช้
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
  }

  private startRenderingLoop(): void {
    const render = () => {
      requestAnimationFrame(render);
      const canvas = this.renderer.domElement;
      if (canvas.clientHeight > 0) {
        const needResize = canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight;
        if (needResize) {
          this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
          this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
          this.camera.updateProjectionMatrix();
        }
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    render();
  }
}