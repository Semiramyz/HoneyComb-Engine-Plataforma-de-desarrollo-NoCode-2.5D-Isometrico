// Implementacion de AudioSystem. El contrato de la clase (que es, y por que
// todo el audio pasa por aca) esta documentado en AudioSystem.hpp.
//
// Se guarda un PUNTERO a la pista actual, no una copia: el dueno del recurso
// Music es el ResourceManager, y esta clase solo controla su reproduccion.

#include "AudioSystem.hpp"

// Los efectos no se recuerdan: se disparan y raylib los mezcla solo. Por eso
// pueden sonar varios a la vez, a diferencia de la musica.
void AudioSystem::PlaySoundEffect(const Sound& sound) {
    PlaySound(sound);
}

// Una sola pista a la vez: si ya habia una sonando se corta antes de empezar la
// nueva. Sin esto las dos sonarian encimadas.
void AudioSystem::PlayMusic(Music& music, bool loop) {
    if (currentMusic_) {
        StopMusicStream(*currentMusic_);
    }
    currentMusic_ = &music;
    loopCurrentMusic_ = loop;
    PlayMusicStream(music);
}

// Poner el puntero en nullptr es lo que hace que Update() deje de trabajar: es
// la marca de "no hay musica", no solo una limpieza.
void AudioSystem::StopMusic() {
    if (currentMusic_) {
        StopMusicStream(*currentMusic_);
        currentMusic_ = nullptr;
    }
}

// Una vez por frame. raylib reproduce la musica en streaming (va leyendo el
// archivo de a pedazos), y sin este llamado continuo el buffer se vacia y el
// sonido se corta.
void AudioSystem::Update() {
    if (!currentMusic_) {
        return;
    }
    UpdateMusicStream(*currentMusic_);
    // Una pista sin loop que ya termino se olvida sola, para que las siguientes
    // llamadas a Update() no sigan trabajando de gusto.
    //
    // FALTA: hoy esta rama no llega a ejecutarse nunca. LoadMusicStream deja
    // music.looping en true (ver raudio.c) y aca no se lo cambia, asi que aun
    // pidiendo loop=false la pista se repite sola: IsMusicStreamPlaying sigue
    // dando true y el puntero no se suelta nunca. Para respetar el parametro
    // habria que asignar currentMusic_->looping = loopCurrentMusic_ dentro de
    // PlayMusic().
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
