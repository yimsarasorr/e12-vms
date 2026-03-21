import { Injectable } from '@angular/core';
import * as THREE from 'three';

interface Boundary {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

type SemanticTone = 'core' | 'circulation' | 'room' | 'vertical' | 'service';

@Injectable({
  providedIn: 'root'
})
export class FloorplanBuilderService {
  // Constants
  private readonly wallHeight = 3;
  private readonly wallThickness = 0.2;
  private readonly coreColor = new THREE.Color('#3333FF');
  private readonly circulationColor = new THREE.Color('#38bdf8');
  private readonly verticalColor = new THREE.Color('#a855f7');
  private readonly serviceColor = new THREE.Color('#f0abfc');
  private readonly roomGradientStart = new THREE.Color('#7c3aed');
  private readonly roomGradientMid = new THREE.Color('#3b82f6');
  private readonly roomGradientEnd = new THREE.Color('#06b6d4');

  // Materials
  private wallMaterial!: THREE.MeshStandardMaterial;
  private objectMaterial!: THREE.MeshStandardMaterial;
  private lockedDoorMaterial!: THREE.MeshStandardMaterial;
  private unlockedDoorMaterial!: THREE.MeshStandardMaterial;
  private mutedFloorMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private areaColorAssignments = new Map<string, number>();
  private roomColorAssignments = new Map<string, number>();

  // Mesh Collections
  private wallMeshes: THREE.Mesh[] = [];
  private objectMeshes: THREE.Mesh[] = [];
  private floorMeshes: THREE.Mesh[] = [];
  private doorMeshes: THREE.Mesh[] = [];

  private floorGroup: THREE.Group | null = null;

  constructor() {
    this.initializeMaterials();
  }

  /**
   * Materials ซ้ำๆ
   */
  private initializeMaterials(): void {
    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.35,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.objectMaterial = new THREE.MeshStandardMaterial({
      color: 0x9aa4b5,
      roughness: 0.75,
      metalness: 0.05
    });
    this.lockedDoorMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4d4f,
      transparent: false,
      opacity: 1,
      roughness: 0.2,
      metalness: 0
    });
    this.unlockedDoorMaterial = new THREE.MeshStandardMaterial({
      color: 0x44ff44,
      transparent: false,
      opacity: 1,
      roughness: 0.2,
      metalness: 0
    });
  }

  /**
   * สร้างโมเดล 3D ทั้งหมดสำหรับชั้น
   * @param floorData ข้อมูล JSON ของชั้น
   * @returns THREE.Group ที่มี Meshes ทั้งหมด
   */
  public buildFloor(floorData: any, doorAllowList: string[] = []): THREE.Group {
    this.clearFloor(); // ล้างของเก่าก่อน (ถ้ามี)
    this.resetColorAssignments();
    this.floorGroup = new THREE.Group();

    const zoneCount = floorData?.zones?.length ?? 0;

    const bounds = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    };

    const extendBounds = (x: number, y: number) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    };

    // ( Logic นี้ย้ายมาจาก loadFloorPlan() ใน component )
    if (floorData?.walls) {
      floorData.walls.forEach((wall: any) => {
        const start = new THREE.Vector3(wall.start.x, 0, wall.start.y);
        const end = new THREE.Vector3(wall.end.x, 0, wall.end.y);
        const wallMesh = this.buildWallMesh(start, end, this.wallHeight, this.wallMaterial);
        this.wallMeshes.push(wallMesh);
        this.floorGroup!.add(wallMesh);
        extendBounds(wall.start.x, wall.start.y);
        extendBounds(wall.end.x, wall.end.y);
      });
    }

    const roomGradientExtent = this.computeRoomExtent(floorData);

    floorData?.zones?.forEach((zone: any) => {
      const areaCount = zone.areas?.length ?? 0;
      const roomCount = zone.rooms?.length ?? 0;
      const zoneBoundaries: Boundary[] = [];

      zone.areas?.forEach((area: any, areaIndex: number) => {
        const areaWidth = area.boundary.max.x - area.boundary.min.x;
        const areaDepth = area.boundary.max.y - area.boundary.min.y;
        const areaGeo = new THREE.PlaneGeometry(areaWidth, areaDepth);
        const areaColor = this.resolveAreaColor(zone.id, area, areaIndex, areaCount);
        const areaMat = new THREE.MeshStandardMaterial({
          color: areaColor,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1,
          roughness: 0.88,
          metalness: 0
        });
        const areaFloor = new THREE.Mesh(areaGeo, areaMat);
        areaFloor.rotation.x = -Math.PI / 2;
        areaFloor.position.set(area.boundary.min.x + areaWidth / 2, 0.01, area.boundary.min.y + areaDepth / 2);
        const areaData = { ...area, floor: floorData.floor, chromaticRole: this.deriveSemanticLayer(area, 'area') };
        areaFloor.userData = { type: 'area', data: areaData };
        this.floorMeshes.push(areaFloor);
        this.floorGroup!.add(areaFloor);
        if (area.boundary) {
          zoneBoundaries.push(area.boundary);
          extendBounds(area.boundary.min.x, area.boundary.min.y);
          extendBounds(area.boundary.max.x, area.boundary.max.y);
        }
      });

      zone.rooms?.forEach((room: any, roomIndex: number) => {
        const roomWidth = room.boundary.max.x - room.boundary.min.x;
        const roomDepth = room.boundary.max.y - room.boundary.min.y;
        const roomGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
        const roomColor = this.resolveRoomColor(zone.id, room, roomIndex, roomCount, roomGradientExtent);
        const primaryRoomMat = new THREE.MeshStandardMaterial({
          color: roomColor,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1,
          roughness: 0.78,
          metalness: 0
        });
        const roomFloor = new THREE.Mesh(roomGeo, primaryRoomMat);
        roomFloor.rotation.x = -Math.PI / 2;
        roomFloor.position.set(room.boundary.min.x + roomWidth / 2, 0.02, room.boundary.min.y + roomDepth / 2);
        const roomData = {
          ...room,
          floor: floorData.floor,
          chromaticRole: this.deriveSemanticLayer(room, 'room')
        };
        roomFloor.userData = { type: 'room', data: roomData };
        this.floorMeshes.push(roomFloor);
        this.floorGroup!.add(roomFloor);
        if (room.boundary) {
          zoneBoundaries.push(room.boundary);
          extendBounds(room.boundary.min.x, room.boundary.min.y);
          extendBounds(room.boundary.max.x, room.boundary.max.y);
        }

        room.doors?.forEach((door: any) => {
          const geo = new THREE.BoxGeometry(door.size.width, this.wallHeight, door.size.depth);

          // ตรวจสอบสิทธิ์ทันทีตอนสร้าง
          const initialMaterial = doorAllowList.includes(door.id) ? this.unlockedDoorMaterial : this.lockedDoorMaterial;

          const mesh = new THREE.Mesh(geo, initialMaterial);
          mesh.position.set(door.center.x, this.wallHeight / 2, door.center.y);
          const doorData = { ...door, floor: floorData.floor };
          mesh.userData = { type: 'door', data: doorData };
          this.doorMeshes.push(mesh);
          this.floorGroup!.add(mesh);
          extendBounds(door.center.x, door.center.y);
        });

        if (room.name) {
          // หาจุดกึ่งกลางห้อง (ถ้ามี room.center ก็ใช้เลย ถ้าไม่มีให้คำนวณจาก boundary)
          let centerX = room.center?.x;
          let centerZ = room.center?.y; // ระวัง: ใน 2D y คือ z ใน 3D

          if (centerX === undefined || centerZ === undefined) {
            centerX = (room.boundary.min.x + room.boundary.max.x) / 2;
            centerZ = (room.boundary.min.y + room.boundary.max.y) / 2;
          }

          const labelMesh = this.createRoomLabel(room.name);

          // วางตำแหน่ง: X, Z ตามห้อง, Y ยกขึ้นนิดนึง (0.2) ไม่ให้จมพื้น
          labelMesh.position.set(centerX, 0.2, centerZ);

          // หมุนให้นอนราบไปกับพื้น
          labelMesh.rotation.x = -Math.PI / 2;

          // (Optional) ถ้าตึกหมุนอยู่แล้ว อาจจะต้องหมุนป้ายตามแกน Z ให้ตัวหนังสือหันถูกทิศ
          // labelMesh.rotation.z = Math.PI; // ลองปรับดูถ้าตัวหนังสือกลับหัว

          this.floorGroup!.add(labelMesh);
        }
      });

      zone.objects?.forEach((obj: any) => {
        const width = obj.boundary.max.x - obj.boundary.min.x;
        const depth = obj.boundary.max.y - obj.boundary.min.y;
        const geo = new THREE.BoxGeometry(width, this.wallHeight, depth);
        const mesh = new THREE.Mesh(geo, this.objectMaterial);
        mesh.position.set(obj.boundary.min.x + width / 2, this.wallHeight / 2, obj.boundary.min.y + depth / 2);
        const objectData = { ...obj, floor: floorData.floor };
        mesh.userData = { type: 'object', data: objectData };
        this.objectMeshes.push(mesh);
        this.floorGroup!.add(mesh);
        if (obj.boundary) {
          zoneBoundaries.push(obj.boundary);
          extendBounds(obj.boundary.min.x, obj.boundary.min.y);
          extendBounds(obj.boundary.max.x, obj.boundary.max.y);
        }
      });

      const combined = this.combineBoundaries(zoneBoundaries);
      if (combined) {
        zone.boundary = combined;
        zone.center = {
          x: (combined.min.x + combined.max.x) / 2,
          y: (combined.min.y + combined.max.y) / 2
        };
      }

      const zoneBoundary = zone.boundary ?? combined ?? zone.zoneBoundary;
      // if (zoneBoundary) {
      //   const zoneWidth = zoneBoundary.max.x - zoneBoundary.min.x;
      //   const zoneDepth = zoneBoundary.max.y - zoneBoundary.min.y;
      //   if (zoneWidth > 0 && zoneDepth > 0) {
      //     const zoneGeo = new THREE.PlaneGeometry(zoneWidth, zoneDepth);
      //     const originalZoneColor = this.resolveZoneColor(zone, zoneCount, zone.areas?.length ?? 0, zone.rooms?.length ?? 0);
      //     const zoneColorObj = new THREE.Color(originalZoneColor);

      //     // 2. ปรับให้จืด (Desaturate) และสว่าง (Lighten)
      //     const zHsl = { h: 0, s: 0, l: 0 };
      //     zoneColorObj.getHSL(zHsl);
      //     // ปรับ Saturation คูณ 0.2 (เหลือความสด 20%)
      //     // ปรับ Lightness เป็น 0.9 (ให้ขาวๆ สว่างๆ)
      //     zoneColorObj.setHSL(zHsl.h, zHsl.s * 0.2, 0.9);

      //     // 3. เอาสีที่จืดแล้วไปสร้าง Material
      //     const zoneMat = new THREE.MeshStandardMaterial({
      //       color: zoneColorObj, // ใช้สีใหม่ที่ปรับแล้ว
      //       side: THREE.DoubleSide,
      //       transparent: false, // Solid ทึบ
      //       opacity: 1,
      //       roughness: 1,       // ด้านสนิท
      //       metalness: 0
      //     });
      //     const zoneFloor = new THREE.Mesh(zoneGeo, zoneMat);
      //     zoneFloor.rotation.x = -Math.PI / 2;
      //     zoneFloor.position.set(zoneBoundary.min.x + zoneWidth / 2, -0.02, zoneBoundary.min.y + zoneDepth / 2);
      //     zoneFloor.renderOrder = -4;
      //     const zoneData = { ...zone, floor: floorData.floor };
      //     zoneFloor.userData = { type: 'zone', data: zoneData };
      //     this.floorMeshes.push(zoneFloor);
      //     this.floorGroup!.add(zoneFloor);
      //     extendBounds(zoneBoundary.min.x, zoneBoundary.min.y);
      //     extendBounds(zoneBoundary.max.x, zoneBoundary.max.y);
      //   }
      // }
    });

    if (Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY)) {
      const padding = 12;
      const baseWidth = bounds.maxX - bounds.minX + padding * 2;
      const baseDepth = bounds.maxY - bounds.minY + padding * 2;
      if (baseWidth > 0 && baseDepth > 0) {
        const baseGeo = new THREE.PlaneGeometry(baseWidth, baseDepth);
        const mutedMaterial = this.getMutedFloorMaterial(floorData?.color ?? 0xdfe6f3);
        const baseMesh = new THREE.Mesh(baseGeo, mutedMaterial);
        baseMesh.rotation.x = -Math.PI / 2;
        baseMesh.position.set(bounds.minX + (bounds.maxX - bounds.minX) / 2, -0.04, bounds.minY + (bounds.maxY - bounds.minY) / 2);
        baseMesh.renderOrder = -5;
        this.floorMeshes.push(baseMesh);
        this.floorGroup!.add(baseMesh);
      }
    }

    return this.floorGroup;
  }

  /**
   * ล้างโมเดลเก่าออกจาก Memory
   */
  public clearFloor(): void {
    if (!this.floorGroup) return;

    this.floorGroup.children.forEach((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.floorGroup = null;
    this.wallMeshes = [];
    this.objectMeshes = [];
    this.floorMeshes = [];
    this.doorMeshes = [];
    this.resetColorAssignments();
  }

  /**
   * (แก้ไข) อัปเดต Material ของประตูตาม "Allow List" (string[])
   */
  public updateDoorMaterials(allowList: string[]): void { // (รับ string[] ไม่ใช่ number)
    this.doorMeshes.forEach(door => {
      const doorId = door.userData['data'].id;
      // (แก้ไข Logic)
      if (allowList.includes(doorId)) {
        door.material = this.unlockedDoorMaterial;
      } else {
        door.material = this.lockedDoorMaterial;
      }
    });
  }

  // --- Getters สำหรับ Service อื่นเรียกใช้ ---
  public getWallMeshes = (): THREE.Mesh[] => this.wallMeshes;
  public getObjectMeshes = (): THREE.Mesh[] => this.objectMeshes;
  public getDoorMeshes = (): THREE.Mesh[] => this.doorMeshes;
  public getFloorMeshes = (): THREE.Mesh[] => this.floorMeshes;

  /**
   * (ย้ายมาจาก component)
   * สร้าง Mesh กำแพง
   */
  private buildWallMesh(start: THREE.Vector3, end: THREE.Vector3, height: number, material: THREE.Material): THREE.Mesh {
    const distance = start.distanceTo(end);
    if (distance < 0.1) return new THREE.Mesh();
    const geometry = new THREE.BoxGeometry(distance, height, this.wallThickness);
    const mesh = new THREE.Mesh(geometry, material);
    const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.set(midPoint.x, height / 2, midPoint.z);
    const direction = new THREE.Vector3().subVectors(end, start);
    mesh.rotation.y = Math.atan2(direction.z, direction.x);
    return mesh;
  }

  /**
   * (ย้ายมาจาก component)
   * รวม Boundary
   */
  private combineBoundaries(boundaries: Boundary[]): Boundary | null {
    if (!boundaries.length) {
      return null;
    }
    return boundaries.reduce((acc, boundary) => ({
      min: {
        x: Math.min(acc.min.x, boundary.min.x),
        y: Math.min(acc.min.y, boundary.min.y)
      },
      max: {
        x: Math.max(acc.max.x, boundary.max.x),
        y: Math.max(acc.max.y, boundary.max.y)
      }
    }));
  }

  private resolveAreaColor(zoneId: string | undefined, area: any, index: number, total: number): number {
    const key = `${zoneId ?? 'zone'}::area::${area.id ?? index}`;
    const cached = this.areaColorAssignments.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const tone = this.deriveSemanticLayer(area, 'area');
    const base = this.getBaseColorForTone(tone);
    let tinted = this.applyIndexTint(base, index, total, tone === 'circulation' ? 0.22 : 0.12);
    if (tone === 'circulation') {
      tinted = this.softenColor(tinted, 0.35);
      tinted = this.adjustLightness(tinted, 0.04);
    } else if (tone === 'core') {
      tinted = this.softenColor(tinted, 0.18);
    } else if (tone === 'service') {
      tinted = this.adjustLightness(tinted, 0.02);
    }
    const hex = tinted.getHex();
    this.areaColorAssignments.set(key, hex);
    return hex;
  }

  private resolveRoomColor(zoneId: string | undefined, room: any, index: number, total: number, extent: { minX: number; maxX: number } | null): number {
    const key = `${zoneId ?? 'zone'}::room::${room.id ?? index}`;
    const cached = this.roomColorAssignments.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const tone = this.deriveSemanticLayer(room, 'room');
    let baseColor: THREE.Color;

    if (tone === 'service') {
      baseColor = this.serviceColor.clone();
    } else if (tone === 'vertical') {
      baseColor = this.verticalColor.clone();
    } else if (tone === 'core') {
      baseColor = this.coreColor.clone();
    } else {
      const factor = this.computeRoomGradientFactor(room, extent, index, total);
      baseColor = this.sampleRoomGradient(factor);
    }

    const refined = this.adjustLightness(baseColor, tone === 'room' ? 0.015 : 0);
    const hex = refined.getHex();
    this.roomColorAssignments.set(key, hex);
    return hex;
  }

  private resolveZoneColor(zone: any, totalZones: number, areaCount: number, roomCount: number): number {
    if (zone?.color) {
      return new THREE.Color(zone.color as any).getHex();
    }

    const tone = this.deriveSemanticLayer(zone, 'area');
    const base = this.getBaseColorForTone(tone === 'room' ? 'core' : tone);
    const softness = roomCount === 0 && areaCount === 0 ? 0.42 : 0.32;
    const lighten = Math.min(0.25, 0.12 + (totalZones > 0 ? (1 / totalZones) * 0.35 : 0));
    const softened = this.softenColor(base, softness);
    const adjusted = this.adjustLightness(softened, lighten);
    return adjusted.getHex();
  }

  private getMutedFloorMaterial(colorInput: number | string): THREE.MeshStandardMaterial {
    const key = typeof colorInput === 'string' ? colorInput : `#${colorInput.toString(16)}`;
    const existing = this.mutedFloorMaterialCache.get(key);
    if (existing) {
      return existing;
    }

    const baseColor = new THREE.Color(colorInput as any);

    const hsl = { h: 0, s: 0, l: 0 };
    baseColor.getHSL(hsl);

    baseColor.setHSL(hsl.h, hsl.s * 1.0, 0.5);

    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      depthWrite: true
    });

    this.mutedFloorMaterialCache.set(key, material);
    return material;
  }

  public getAssignedRoomColor(roomId: string): string | null {
    for (const [key, value] of this.roomColorAssignments.entries()) {
      if (key.endsWith(`::${roomId}`)) {
        return `#${value.toString(16).padStart(6, '0')}`;
      }
    }
    return null;
  }

  private resetColorAssignments(): void {
    this.areaColorAssignments.clear();
    this.roomColorAssignments.clear();
  }

  private deriveSemanticLayer(entity: any, fallback: 'room' | 'area'): SemanticTone {
    const descriptor = `${entity?.type ?? ''} ${entity?.name ?? ''} ${entity?.id ?? ''}`.toLowerCase();

    if (/(lift|elevator|stairs|shaft|escalator|hoist)/.test(descriptor)) {
      return 'vertical';
    }
    if (/(restroom|toilet|washroom|bath|mechanical|electrical|service|storage|utility)/.test(descriptor)) {
      return 'service';
    }
    if (/(lobby|atrium|foyer|plaza|commons|hub|core)/.test(descriptor)) {
      return 'core';
    }
    if (/(hallway|corridor|walkway|passage|aisle|concourse)/.test(descriptor)) {
      return 'circulation';
    }

    if (fallback === 'area') {
      return 'circulation';
    }

    return 'room';
  }

  private getBaseColorForTone(tone: SemanticTone): THREE.Color {
    switch (tone) {
      case 'core':
        return this.coreColor.clone();
      case 'circulation':
        return this.circulationColor.clone();
      case 'vertical':
        return this.verticalColor.clone();
      case 'service':
        return this.serviceColor.clone();
      default:
        return this.roomGradientStart.clone();
    }
  }

  private applyIndexTint(base: THREE.Color, index: number, total: number, span: number): THREE.Color {
    if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 1) {
      return base.clone();
    }
    const normalized = index / (total - 1);
    const delta = (normalized - 0.5) * span * 2;
    return this.adjustLightness(base.clone(), delta);
  }

  private computeRoomExtent(floorData: any): { minX: number; maxX: number } | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    floorData?.zones?.forEach((zone: any) => {
      zone.rooms?.forEach((room: any) => {
        minX = Math.min(minX, room.boundary?.min?.x ?? Number.POSITIVE_INFINITY);
        maxX = Math.max(maxX, room.boundary?.max?.x ?? Number.NEGATIVE_INFINITY);
      });
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
      return null;
    }

    return { minX, maxX };
  }

  private computeRoomGradientFactor(room: any, extent: { minX: number; maxX: number } | null, fallbackIndex: number, total: number): number {
    if (extent) {
      const centerX = ((room.boundary?.min?.x ?? 0) + (room.boundary?.max?.x ?? 0)) / 2;
      if (Number.isFinite(centerX)) {
        const range = extent.maxX - extent.minX;
        if (range > 0) {
          const factor = (centerX - extent.minX) / range;
          return Math.min(1, Math.max(0, factor));
        }
      }
    }

    if (!Number.isFinite(total) || total <= 1) {
      return 0;
    }
    return Math.min(1, Math.max(0, fallbackIndex / (total - 1)));
  }

  private sampleRoomGradient(factor: number): THREE.Color {
    const clamped = Math.min(1, Math.max(0, factor));
    if (clamped <= 0.5) {
      const phase = clamped / 0.5;
      return this.roomGradientStart.clone().lerp(this.roomGradientMid, phase);
    }
    const phase = (clamped - 0.5) / 0.5;
    return this.roomGradientMid.clone().lerp(this.roomGradientEnd, phase);
  }

  private softenColor(color: THREE.Color, factor: number): THREE.Color {
    const clamped = Math.min(1, Math.max(0, factor));
    const neutral = new THREE.Color('#e2e8f0');
    return color.clone().lerp(neutral, clamped);
  }

  private adjustLightness(color: THREE.Color, delta: number): THREE.Color {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    const nextL = Math.min(0.92, Math.max(0.12, hsl.l + delta));
    color.setHSL(hsl.h, hsl.s, nextL);
    return color;
  }

  private createRoomLabel(text: string): THREE.Mesh {
    // ใช้ Canvas ใหญ่ขึ้นเพื่อให้ Font คมชัด
    const width = 2560;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // พื้นหลังใส
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, width, height);

    // Font ใหญ่
    ctx.font = 'bold 480px "Kanit", "Inter", sans-serif';
    ctx.fillStyle = '#ffffffff'; // สีเทาเข้ม
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false, // ป้ายบนพื้นปิด depthWrite เพื่อความเนียน
    });

    // ขนาดป้ายบนโลก 3D (5 x 1.25 เมตร)
    const geometry = new THREE.PlaneGeometry(7.5, 1.5);
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
  }
}