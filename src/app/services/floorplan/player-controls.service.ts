// src/app/services/floorplan/player-controls.service.ts
import { Injectable, inject } from '@angular/core';
import * as THREE from 'three';
import { ThreeSceneService } from './three-scene.service';
import { FloorplanBuilderService } from './floorplan-builder.service';

@Injectable({
  providedIn: 'root'
})
export class PlayerControlsService {
  private threeSceneService = inject(ThreeSceneService);
  private floorplanBuilder = inject(FloorplanBuilderService);

  public player: THREE.Mesh | null = null;
  public playerSize = 0.5;
  private playerSpeed = 0.1;

  // เก็บ Input จาก Keyboard/Joystick
  private moveVector = new THREE.Vector2(0, 0); // x: right, y: forward
  private keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

  // เก็บ Camera direction
  private cameraDirection = new THREE.Vector3();
  private rightDirection = new THREE.Vector3();

  public initialize(): void {
    this.dispose();
    this.createPlayer();
  }

  private createPlayer(): void {
    const playerGeometry = new THREE.CylinderGeometry(this.playerSize / 2, this.playerSize / 2, this.playerSize * 2);
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
    this.player = new THREE.Mesh(playerGeometry, playerMaterial);
    this.player.position.set(0, this.playerSize, 0);
    this.player.castShadow = true;
    this.threeSceneService.scene.add(this.player);
  }

  public dispose(): void {
    if (this.player) {
      try {
        this.threeSceneService.scene?.remove(this.player);
        this.player.geometry?.dispose();
        if (Array.isArray(this.player.material)) {
          this.player.material.forEach((material: THREE.Material) => material.dispose());
        } else {
          this.player.material?.dispose?.();
        }
      } catch {
        // ignore disposal errors
      }
    }

    this.player = null;
    this.moveVector.set(0, 0);
    Object.keys(this.keys).forEach(key => ((this.keys as any)[key] = false));
  }

  /**
   * รับ Input การเคลื่อนที่จาก Keyboard
   */
  public setKeyboardInput(key: string, state: boolean): void {
    if (key in this.keys) {
      (this.keys as any)[key] = state;
      
      // อัปเดต moveVector จาก keys
      this.moveVector.y = 0;
      this.moveVector.x = 0;
      if (this.keys.ArrowUp) this.moveVector.y += 1;
      if (this.keys.ArrowDown) this.moveVector.y -= 1;
      if (this.keys.ArrowLeft) this.moveVector.x -= 1;
      if (this.keys.ArrowRight) this.moveVector.x += 1;
    }
  }

  /**
   * รับ Input การเคลื่อนที่จาก Joystick (สำหรับอนาคต)
   * @param x ค่าแกน X (-1 ถึง 1)
   * @param y ค่าแกน Y (-1 ถึง 1)
   */
  public setJoystickInput(x: number, y: number): void {
    // ถ้า keyboard ถูกกดอยู่ ให้ joystick หยุดทำงาน
    if (this.keys.ArrowUp || this.keys.ArrowDown || this.keys.ArrowLeft || this.keys.ArrowRight) {
      return;
    }
    this.moveVector.x = -x; // แกน X ของ Joystick มักจะตรงข้าม
    this.moveVector.y = y;
  }

  /**
   * (แก้ไข) อัปเดตตำแหน่ง Player ในทุก Frame
   */
  public update(allowList: string[]): void { // (เปลี่ยน accessLevel เป็น allowList)
    if (!this.player || !this.threeSceneService.camera) return;

    // 1. คำนวณทิศทาง
    this.threeSceneService.camera.getWorldDirection(this.cameraDirection);
    this.cameraDirection.y = 0;
    this.cameraDirection.normalize();
    this.rightDirection.crossVectors(this.threeSceneService.camera.up, this.cameraDirection).normalize();

    // 2. สร้าง Vector เคลื่อนที่
    const finalMoveVector = new THREE.Vector3(0, 0, 0);
    finalMoveVector.addScaledVector(this.cameraDirection, this.moveVector.y); // (forward/backward)
    finalMoveVector.addScaledVector(this.rightDirection, this.moveVector.x); // (left/right)

    if (finalMoveVector.lengthSq() > 0) {
      finalMoveVector.normalize().multiplyScalar(this.playerSpeed);
      const newPosition = this.player.position.clone().add(finalMoveVector);

      // 3. เช็ค Collision (ส่ง allowList เข้าไป)
      if (!this.checkCollision(newPosition, allowList)) {
        this.player.position.copy(newPosition);
      }
    }
  }

  /**
   * (แก้ไข) เช็คการชนกับกำแพง, ประตู, และวัตถุ
   */
  private checkCollision(newPosition: THREE.Vector3, allowList: string[]): boolean { // (เปลี่ยน accessLevel เป็น allowList)
    const playerBox = new THREE.Box3().setFromCenterAndSize(
      newPosition, new THREE.Vector3(this.playerSize, this.playerSize * 2, this.playerSize)
    );

    for (const wall of this.floorplanBuilder.getWallMeshes()) {
      if (playerBox.intersectsBox(new THREE.Box3().setFromObject(wall))) return true;
    }
    for (const obj of this.floorplanBuilder.getObjectMeshes()) {
      if (playerBox.intersectsBox(new THREE.Box3().setFromObject(obj))) return true;
    }
    // (แก้ไข Logic การเช็คประตู)
    for (const door of this.floorplanBuilder.getDoorMeshes()) {
      const doorId = door.userData['data'].id;
      // ถ้า ID ประตู "ไม่" อยู่ใน Allow List และ Player ชน
      if (!allowList.includes(doorId) && playerBox.intersectsBox(new THREE.Box3().setFromObject(door))) {
        return true;
      }
    }
    return false;
  }
}