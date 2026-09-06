#include "AudioSystem.hpp"

void AudioSystem::PlaySoundEffect(const Sound& sound) {
    PlaySound(sound);
}

void AudioSystem::PlayMusic(Music& music, bool loop) {
    if (currentMusic_) {
        StopMusicStream(*currentMusic_);
    }
    currentMusic_ = &music;
    loopCurrentMusic_ = loop;
    PlayMusicStream(music);
}

void AudioSystem::StopMusic() {
    if (currentMusic_) {
        StopMusicStream(*currentMusic_);
        currentMusic_ = nullptr;
    }
}

void AudioSystem::Update() {
    if (!currentMusic_) {
        return;
    }
    UpdateMusicStream(*currentMusic_);
    if (!loopCurrentMusic_ && !IsMusicStreamPlaying(*currentMusic_)) {
        currentMusic_ = nullptr;
    }
}

void AudioSystem::SetMusicVolume(float volume) {
    if (currentMusic_) {
        // Calificado con :: para llamar a la funcion global de raylib y no
        // recursar sobre este mismo metodo (mismo nombre).
        ::SetMusicVolume(*currentMusic_, volume);
    }
}
