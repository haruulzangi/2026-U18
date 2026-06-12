package mn.haruulzangi.u18_2026.my_vault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.Certificate
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class KeyStoreCrypto {
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply {
        load(null)
    }
    private val secureRandom = SecureRandom()

    fun createAttestedHandshakeKey(attestationChallenge: ByteArray): AttestedKeyPair {
        keyStore.deleteEntry(HANDSHAKE_KEY_ALIAS)
        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA,
            ANDROID_KEYSTORE,
        )
        val specBuilder = KeyGenParameterSpec.Builder(
                HANDSHAKE_KEY_ALIAS,
                KeyProperties.PURPOSE_DECRYPT,
            )
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA512)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setKeySize(RSA_KEY_SIZE_BITS)
                .setAttestationChallenge(attestationChallenge)
        if (Build.VERSION.SDK_INT >= 35) {
            specBuilder.setMgf1Digests(KeyProperties.DIGEST_SHA256)
        }
        generator.initialize(specBuilder.build())
        val keyPair = generator.generateKeyPair()
        val certificateChain = keyStore.getCertificateChain(HANDSHAKE_KEY_ALIAS)
            ?.toList()
            ?: error("Attestation certificate chain is missing")
        return AttestedKeyPair(keyPair, certificateChain)
    }

    fun decryptSessionKey(encryptedSessionKey: ByteArray): ByteArray {
        val privateKey = keyStore.getKey(HANDSHAKE_KEY_ALIAS, null)
            ?: error("Handshake key is missing")
        val cipher = Cipher.getInstance(RSA_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, privateKey, RSA_OAEP_SHA256_SPEC)
        return cipher.doFinal(encryptedSessionKey)
    }

    fun decryptFlag(
        sessionKey: ByteArray,
        iv: ByteArray,
        ciphertext: ByteArray,
        aad: ByteArray?,
    ): String {
        val secretKey = SecretKeySpec(sessionKey, AES)
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_BITS, iv))
        if (aad != null) {
            cipher.updateAAD(aad)
        }
        return cipher.doFinal(ciphertext).toString(StandardCharsets.UTF_8)
    }

    fun randomBytes(size: Int): ByteArray =
        ByteArray(size).also(secureRandom::nextBytes)

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val HANDSHAKE_KEY_ALIAS = "my-vault-flag-key"
        const val RSA_KEY_SIZE_BITS = 2048
        const val RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        const val AES = "AES"
        const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
        val RSA_OAEP_SHA256_SPEC = OAEPParameterSpec(
            "SHA-256",
            "MGF1",
            MGF1ParameterSpec.SHA256,
            PSource.PSpecified.DEFAULT,
        )
    }
}

data class AttestedKeyPair(
    val keyPair: KeyPair,
    val certificateChain: List<Certificate>,
)
