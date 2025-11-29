import {ImageBackground, ScrollView, Text, TouchableOpacity, View} from "react-native";
import {Image} from "expo-image";
import LinkText from "@/components/LinkText";
import React, {useEffect, useState} from "react";
import {onAuthStateChanged, User} from "firebase/auth";
import {auth} from "@/FirebaseConfig";
import {router} from "expo-router";
import {Icon} from "react-native-paper/src";
import * as ImagePicker from 'expo-image-picker';
import api from "@/api";

export default function Index() {
     const [user, setUser] = useState<User | null>(null);
     const [editOverlay, setEditOverlay] = useState(false);
     const [error, setError] = useState("");

     useEffect(() => {
        onAuthStateChanged(auth, () => {
            if (auth.currentUser) {
                if (auth.currentUser.isAnonymous) {
                    router.replace("/login");
                }
                setUser(auth.currentUser);
            }
        });
    }, []);

     const updateAvatar = async () => {
         const user = auth.currentUser;
        if (user && !user.isAnonymous) {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7
            })

            if (!result.canceled && result.assets) {
                const asset = result.assets[0];
                const image = await fetch(asset.uri);
                const blob = await image.blob();

                if (blob && (blob.type == "image/jpeg" || blob.type == "image/png")) {
                    const formData = new FormData();
                    formData.append("image", blob, `${user.uid}`);

                    api.post('user/uploadAvatarByUID', formData)
                        .then((res) => {
                            setUser(res.data);
                        })
                        .catch((err) => {
                            console.log(err);
                        })
                }
            }
        }
        else {
            setError("Please sign in to customise your profile");
        }
     }

    return (
        <ImageBackground
            source={require('@/assets/images/background.png')}
            className="flex-1"
            resizeMode="cover"
        >
            <View className="flex-1 px-5 justify-center items-center" style={{backgroundColor: 'rgba(0,0,0,0.5)'}}>
                <ScrollView className="w-full">
                    <View className="w-full justify-center items-center mt-20">
                        <View className="relative justify-center items-center w-[94px] h-[94px] rounded-full bg-black border-4 border-gray-200 overflow-hidden">
                            {editOverlay && (
                                <View className="absolute" style={{zIndex:2}}>
                                    <Icon source="pencil" size={35} color="#DDDDDD"/>
                                </View>
                            )}
                            <TouchableOpacity style={{zIndex:1}} activeOpacity={0.6} onPressIn={() => setEditOverlay(true)}
                                              onPressOut={() => {
                                                  setEditOverlay(false);
                                                  updateAvatar();
                                              }}
                            >
                                <Image
                                    source={user?.photoURL}
                                    style={{ width: 90, height: 90 }}
                                    contentFit="cover"
                                />
                            </TouchableOpacity>
                        </View>

                        <View className="flex-row">
                            <Text className="text-primary text-xl font-medium mt-4">{user?.displayName || "New_User"}</Text>
                        </View>
                    </View>
                    <Text className="text-primary text-lg font-medium mt-3">Statistics</Text>
                    <Text className="text-primary text-lg font-medium mt-3">Statistics</Text>
                    <Text className="text-primary text-lg font-medium mt-3">Your Top Picks</Text>
                    <LinkText
                        className="text-primary text-lg"
                        color="text-primary"
                        highlightColor="text-secondary-100 underline"
                        text="Login"
                        route="/(auth)/login"
                    />
                    <LinkText
                        className="text-primary text-lg"
                        color="text-primary"
                        highlightColor="text-secondary-100 underline"
                        text="verify"
                        route="/verify"
                    />
                </ScrollView>
            </View>
        </ImageBackground>
    );
}