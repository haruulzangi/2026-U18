package mn.haruulzangi.u18_2026.my_vault

import android.content.Context
import android.provider.Settings
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.scottyab.rootbeer.RootBeer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.builtins.ByteArraySerializer
import kotlinx.serialization.cbor.Cbor
import java.security.MessageDigest

private val Context.flagDataStore by preferencesDataStore(name = "vault_flags")

class FlagRepository(
    private val context: Context,
    private val crypto: KeyStoreCrypto,
    private val handshakeClient: HandshakeClient,
) {
    suspend fun hasSavedFlag(): Boolean = withContext(Dispatchers.IO) {
        context.flagDataStore.data
            .map { preferences -> preferences[FLAG_KEY].isNullOrBlank().not() }
            .first()
    }

    suspend fun isDeviceRooted(): Boolean = withContext(Dispatchers.IO) {
        RootBeer(context).isRooted
    }

    suspend fun isDeveloperModeEnabled(): Boolean = withContext(Dispatchers.IO) {
        isSettingEnabled(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED)
    }

    suspend fun isAdbEnabled(): Boolean = withContext(Dispatchers.IO) {
        isSettingEnabled(Settings.Global.ADB_ENABLED)
    }

    suspend fun retrieveDecryptAndSaveFlag(): String = withContext(Dispatchers.IO) {
        val developerModeEnabled = runPhase("check developer mode") {
            isSettingEnabled(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED)
        }
        if (developerModeEnabled) {
            throw DeveloperModeEnabledException()
        }

        val adbEnabled = runPhase("check adb") {
            isSettingEnabled(Settings.Global.ADB_ENABLED)
        }
        if (adbEnabled) {
            throw AdbEnabledException()
        }

        val rooted = runPhase("perform root checks") {
            RootBeer(context).isRooted
        }
        if (rooted) {
            throw RootDetectedException()
        }

        val clientNonce = crypto.randomBytes(CLIENT_NONCE_BYTES)
        val attestedKeyPair = runPhase("generate attested KeyStore RSA key") {
            crypto.createAttestedHandshakeKey(clientNonce)
        }

        val response = runPhase("perform encrypted server handshake") {
            handshakeClient.retrieveEncryptedFlag(
                publicKey = attestedKeyPair.keyPair.public.encoded,
                clientNonce = clientNonce,
                attestationCertificates = attestedKeyPair.certificateChain.map { it.encoded },
            )
        }

        val sessionKey = runPhase("decrypt RSA session key") {
            crypto.decryptSessionKey(response.encryptedSessionKey)
        }
        val aad = runPhase("verify response AAD") {
            response.aad?.takeIf { MessageDigest.isEqual(it.decodeCborByteString(), clientNonce) }
                ?: throw AadVerificationException()
        }
        val flag = runPhase("decrypt AES-GCM flag") {
            crypto.decryptFlag(
                sessionKey = sessionKey,
                iv = response.flagIv,
                ciphertext = response.encryptedFlag,
                aad = aad,
            )
        }

        runPhase("save flag to DataStore") {
            context.flagDataStore.edit { preferences ->
                preferences[FLAG_KEY] = flag
            }
        }

        flag
    }

    private suspend fun <T> runPhase(phase: String, block: suspend () -> T): T =
        try {
            block()
        } catch (error: DeviceNotSecureException) {
            throw error
        } catch (error: Exception) {
            throw FlagLoadException(phase, error)
        }

    private fun isSettingEnabled(name: String): Boolean =
        Settings.Global.getInt(context.contentResolver, name, 0) != 0

    @OptIn(ExperimentalSerializationApi::class)
    private fun ByteArray.decodeCborByteString(): ByteArray =
        AAD_CBOR.decodeFromByteArray(ByteArraySerializer(), this)

    @OptIn(ExperimentalSerializationApi::class)
    private companion object {
        const val CLIENT_NONCE_BYTES = 32
        val AAD_CBOR = Cbor {
            alwaysUseByteString = true
        }
        val FLAG_KEY = stringPreferencesKey("flag")
    }
}

class FlagLoadException(
    phase: String,
    cause: Throwable,
) : Exception("Failed to $phase: ${cause.message ?: cause::class.java.simpleName}", cause)

class RootDetectedException : Exception("Rooted device detected. Flag fetch disabled.")

class DeveloperModeEnabledException : Exception("Developer mode is enabled. Flag fetch disabled.")

class AdbEnabledException : Exception("ADB debugging is enabled. Flag fetch disabled.")

class AadVerificationException : Exception("Response AAD did not match the client nonce.")

class DeviceNotSecureException :
    Exception("Your device is not secure, therefore flag cannot be issued.")
