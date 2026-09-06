#pragma once

#include "raylib.h"

// Envoltorio de reproduccion de audio en tiempo de juego: toma los recursos
// Sound/Music que carga ResourceManager (Capa 1) y controla su reproduccion.
// Ningun System de la Capa 2 debe llamar PlaySound/PlayMusicStream
// directamente -- todo pasa por aca, igual que GraphicsDevice para dibujo.
class AudioSystem {
public:
    void PlaySoundEffect(const Sound& sound);

    // Solo una pista de musica activa a la vez (reemplaza la anterior si habia).
    void PlayMusic(Music& music, bool loop = true);
    void StopMusic();

    // Llamar una vez por frame: raylib necesita UpdateMusicStream() continuo
    // mientras suena musica en streaming.
    void Update();

    void SetMusicVolume(float volume);

private:
    Music* currentMusic_ = nullptr;
    bool loopCurrentMusic_ = true;
};
